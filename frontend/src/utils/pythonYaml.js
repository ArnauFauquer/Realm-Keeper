// YAML read the way the backend reads it. A sheet is parsed on both sides
// (utils/sheet.js here, services/sheet_parser.py there), and the backend is the
// authority: it stores the sheet. It reads YAML with PyYAML's SafeLoader, which
// is YAML 1.1 with Python's types, so this does the same: `yes` is true, `010`
// is 8, `1_000` is 1000, `1e3` is a string but `1.0e+3` a float, `1:30` is 90,
// `2024-01-01` a date; a duplicated key keeps the last value; `<<` merges
// mappings in; and what comes out keeps Python's distinctions (an int from a
// float, a dict's keys by Python equality) so that turning it into text gives
// what Python's str() gives ("True", "1.0", "['a', 1]").
//
// The `yaml` package only does the syntax (with the failsafe schema every
// scalar stays a string); which type a scalar has is decided here, with
// PyYAML's own patterns (yaml/resolver.py) and constructors (yaml/constructor.py).
//
// Known differences, all far from what a sheet holds: `!!set`, `!!omap`,
// `!!pairs` and `!!binary` are refused here (PyYAML accepts them); an int
// beyond 2^53 loses precision once it is a counter; and the two libraries
// may disagree about malformed YAML at the edges of the syntax, in which case
// the backend's refusal on save is the one that counts.
import { isAlias, isMap, isScalar, isSeq, parseDocument, visit } from 'yaml'

export class YamlError extends Error {}

const TAG = 'tag:yaml.org,2002:'
const STR = `${TAG}str`
const INT = `${TAG}int`
const FLOAT = `${TAG}float`
const BOOL = `${TAG}bool`
const NULL = `${TAG}null`
const TIMESTAMP = `${TAG}timestamp`
const MERGE = `${TAG}merge`
const VALUE = `${TAG}value`

// PyYAML's implicit resolvers, in its order: the first that matches a plain
// scalar gives its type, otherwise it is a string.
const IMPLICIT = [
  [BOOL, /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/],
  [
    FLOAT,
    /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/
  ],
  [INT, /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/],
  [MERGE, /^(?:<<)$/],
  [NULL, /^(?:~|null|Null|NULL|)$/],
  [
    TIMESTAMP,
    /^(?:[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]|[0-9][0-9][0-9][0-9]-[0-9][0-9]?-[0-9][0-9]?(?:[Tt]|[ \t]+)[0-9][0-9]?:[0-9][0-9]:[0-9][0-9](?:\.[0-9]*)?(?:[ \t]*(?:Z|[-+][0-9][0-9]?(?::[0-9][0-9])?))?)$/
  ],
  [VALUE, /^(?:=)$/]
]
const TIMESTAMP_PARTS =
  /^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:(?:[Tt]|[ \t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\.([0-9]*))?(?:[ \t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?)?$/
const BOOL_VALUES = { yes: true, no: false, true: true, false: false, on: true, off: false }
const SUPPORTED_COLLECTION_TAGS = new Set([undefined, '!', `${TAG}map`, `${TAG}seq`])

/** A Python float. Ints are plain numbers (BigInt past 2^53), so a float is
 * kept apart from them: `subtitle: 1.0` is "1.0", not "1". */
export class PyFloat {
  constructor(value) {
    this.value = value
  }
}

/** A datetime.date, or a datetime.datetime when it has a time. `offset` is in
 * minutes, null for a time without a zone. */
export class PyDate {
  constructor(parts) {
    Object.assign(this, parts)
  }

  get hasTime() {
    return this.hour !== undefined
  }
}

const isInt = (value) => typeof value === 'number' || typeof value === 'bigint'

/** A Python dict: keys compare as Python compares them (1, 1.0 and true are
 * the same key; the first one written stays, with the last value), and the
 * order is the order they were first written in. */
export class PyDict {
  constructor() {
    this.items = new Map()
  }

  set(key, value) {
    const id = keyId(key)
    const entry = this.items.get(id)
    if (entry) entry[1] = value
    else this.items.set(id, [key, value])
  }

  /** The value under a string key (no other key equals a string in Python). */
  get(name, fallback = null) {
    const entry = this.items.get(`s${name}`)
    return entry ? entry[1] : fallback
  }

  has(name) {
    return this.items.has(`s${name}`)
  }

  entries() {
    return [...this.items.values()]
  }

  get size() {
    return this.items.size
  }
}

function keyId(key) {
  if (typeof key === 'string') return `s${key}`
  if (key === null) return 'none'
  if (typeof key === 'boolean') return key ? 'n1' : 'n0'
  if (isInt(key)) return `n${key}`
  if (key instanceof PyFloat) {
    // PyYAML builds every .nan as the same float, so they are one key.
    if (Number.isNaN(key.value)) return 'nan'
    return Number.isInteger(key.value) ? `n${BigInt(key.value)}` : `n${key.value}`
  }
  if (key instanceof PyDate) return `d${key.offset === null ? 'naive' : 'aware'}${pyStr(key)}`
  throw new YamlError('found unhashable key')
}

// ── text, as Python's str() and repr() write it ─────────────────────────────

// What str.strip() strips: Python's whitespace, which is not quite JavaScript's.
const PY_SPACE = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g')
export const pyStrip = (text) => text.replace(PY_STRIP, '')

function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan'
  if (x === Infinity) return 'inf'
  if (x === -Infinity) return '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0'
  // The shortest digits that read back as the same float, as Python picks them.
  const [mantissa, exponent] = x.toExponential().split('e')
  const exp = Number(exponent)
  const sign = x < 0 ? '-' : ''
  const digits = mantissa.replace('-', '').replace('.', '')
  if (exp < -4 || exp >= 16) {
    const fraction = digits.length > 1 ? `.${digits.slice(1)}` : ''
    return `${sign}${digits[0]}${fraction}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`
  if (digits.length > exp + 1) return `${sign}${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`
  return `${sign}${digits}${'0'.repeat(exp + 1 - digits.length)}.0`
}

const NOT_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u
const hex = (code, width) => code.toString(16).padStart(width, '0')

function strRepr(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  let out = quote
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (ch === quote || ch === '\\') out += `\\${ch}`
    else if (ch === '\t') out += '\\t'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (code < 0x20 || code === 0x7f) out += `\\x${hex(code, 2)}`
    else if (code < 0x7f || ch === ' ' || !NOT_PRINTABLE.test(ch)) out += ch
    else if (code <= 0xff) out += `\\x${hex(code, 2)}`
    else if (code <= 0xffff) out += `\\u${hex(code, 4)}`
    else out += `\\U${hex(code, 8)}`
  }
  return out + quote
}

const pad = (n, width = 2) => String(n).padStart(width, '0')

function dateStr(d) {
  const date = `${pad(d.year, 4)}-${pad(d.month)}-${pad(d.day)}`
  if (!d.hasTime) return date
  const micro = d.micro ? `.${pad(d.micro, 6)}` : ''
  let zone = ''
  if (d.offset !== null) {
    const abs = Math.abs(d.offset)
    zone = `${d.offset < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  }
  return `${date} ${pad(d.hour)}:${pad(d.minute)}:${pad(d.second)}${micro}${zone}`
}

function dateRepr(d) {
  if (!d.hasTime) return `datetime.date(${d.year}, ${d.month}, ${d.day})`
  const fields = [d.year, d.month, d.day, d.hour, d.minute]
  if (d.second || d.micro) fields.push(d.second)
  if (d.micro) fields.push(d.micro)
  let zone = ''
  if (d.offset === 0) zone = ', tzinfo=datetime.timezone.utc'
  else if (d.offset !== null) {
    // A timedelta keeps whole days apart, and its seconds are never negative.
    const seconds = d.offset * 60
    const days = Math.floor(seconds / 86400)
    const rest = seconds - days * 86400
    const delta = [days ? `days=${days}` : '', rest ? `seconds=${rest}` : ''].filter(Boolean).join(', ')
    zone = `, tzinfo=datetime.timezone(datetime.timedelta(${delta}))`
  }
  return `datetime.datetime(${fields.join(', ')}${zone})`
}

/** Python's repr() of a value read by loadYaml. */
export function pyRepr(value) {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (isInt(value)) return String(value)
  if (typeof value === 'string') return strRepr(value)
  if (value instanceof PyFloat) return floatRepr(value.value)
  if (value instanceof PyDate) return dateRepr(value)
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`
  if (value instanceof PyDict) return `{${value.entries().map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`).join(', ')}}`
  return String(value)
}

/** Python's str() of a value read by loadYaml. */
export function pyStr(value) {
  if (typeof value === 'string') return value
  if (value instanceof PyDate) return dateStr(value)
  return pyRepr(value)
}

/** A value read by loadYaml as plain JSON, as the backend's API sends it. */
export function toJson(value) {
  if (isInt(value)) return Number(value)
  if (value instanceof PyFloat) return value.value
  if (value instanceof PyDate) return value.hasTime ? dateStr(value).replace(' ', 'T') : dateStr(value)
  if (Array.isArray(value)) return value.map(toJson)
  if (value instanceof PyDict) {
    const out = {}
    for (const [key, item] of value.entries()) {
      const name = typeof key === 'string' ? key : key === null ? 'null' : typeof key === 'boolean' ? String(key) : pyStr(key)
      out[name] = toJson(item)
    }
    return out
  }
  return value ?? null
}

// ── PyYAML's constructors ───────────────────────────────────────────────────

// "1:30" is 1*60 + 30, summed from the right as PyYAML sums it (for a float,
// the order changes the rounding).
function sexagesimal(parts, sixty, zero) {
  let total = zero
  let base = sixty / sixty
  for (const part of parts.reverse()) {
    total += part * base
    base *= sixty
  }
  return total
}

function constructInt(text) {
  let value = text.replace(/_/g, '')
  let sign = 1n
  if (value[0] === '-') sign = -1n
  if (value[0] === '-' || value[0] === '+') value = value.slice(1)
  let n
  if (value === '0') n = 0n
  else if (value.startsWith('0b')) n = BigInt(`0b${value.slice(2)}`)
  else if (value.startsWith('0x')) n = BigInt(`0x${value.slice(2)}`)
  else if (value[0] === '0') n = BigInt(`0o${value.slice(1)}`)
  else if (value.includes(':')) n = sexagesimal(value.split(':').map((part) => BigInt(part === '' ? NaN : part)), 60n, 0n)
  else n = BigInt(value === '' ? NaN : value)
  n *= sign
  return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n
}

const DECIMAL = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:e[-+]?[0-9]+)?$/
const decimal = (text) => {
  if (!DECIMAL.test(text)) throw new YamlError(`could not convert string to float: '${text}'`)
  return Number(text)
}

function constructFloat(text) {
  let value = text.replace(/_/g, '').toLowerCase()
  let sign = 1
  if (value[0] === '-') sign = -1
  if (value[0] === '-' || value[0] === '+') value = value.slice(1)
  if (value === '.inf') return new PyFloat(sign * Infinity)
  if (value === '.nan') return new PyFloat(NaN)
  if (value.includes(':')) return new PyFloat(sign * sexagesimal(value.split(':').map(decimal), 60, 0))
  return new PyFloat(sign * decimal(value))
}

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()

function constructTimestamp(text) {
  const m = TIMESTAMP_PARTS.exec(text)
  if (!m) throw new YamlError(`invalid timestamp: '${text}'`)
  const [year, month, day] = [m[1], m[2], m[3]].map(Number)
  if (year < 1) throw new YamlError(`year ${year} is out of range`)
  if (month < 1 || month > 12) throw new YamlError(`month must be in 1..12, not ${month}`)
  if (day < 1 || day > daysInMonth(year, month)) throw new YamlError('day is out of range for month')
  if (m[4] === undefined) return new PyDate({ year, month, day })
  const [hour, minute, second] = [m[4], m[5], m[6]].map(Number)
  if (hour > 23) throw new YamlError('hour must be in 0..23')
  if (minute > 59) throw new YamlError('minute must be in 0..59')
  if (second > 59) throw new YamlError('second must be in 0..59')
  const micro = m[7] ? Number(m[7].slice(0, 6).padEnd(6, '0')) : 0
  let offset = null
  if (m[9]) {
    offset = (Number(m[10]) * 60 + Number(m[11] || 0)) * (m[9] === '-' ? -1 : 1)
    if (Math.abs(offset) >= 24 * 60) throw new YamlError('offset must be a timedelta strictly between -timedelta(hours=24) and timedelta(hours=24)')
  } else if (m[8]) offset = 0
  return new PyDate({ year, month, day, hour, minute, second, micro, offset })
}

// A scalar's text. The failsafe schema leaves every scalar a string, except
// the few tags the `yaml` package always knows (`!!timestamp`, `!!binary`),
// whose text is still in the source.
const scalarText = (node) => (typeof node.value === 'string' ? node.value : String(node.source))

/** The tag PyYAML gives a scalar: its own, or the implicit one of a plain
 * scalar (or of one tagged just `!`, which PyYAML resolves the same way). */
function scalarTag(node) {
  if (node.tag && node.tag !== '!') return node.tag
  if (node.tag !== '!' && node.type !== 'PLAIN') return STR
  const text = scalarText(node)
  for (const [tag, pattern] of IMPLICIT) {
    if (pattern.test(text)) return tag
  }
  return STR
}

function constructScalar(node) {
  const tag = scalarTag(node)
  const text = scalarText(node)
  switch (tag) {
    case STR:
      return text
    case NULL:
      return null
    case BOOL: {
      const value = BOOL_VALUES[text.toLowerCase()]
      if (value === undefined) throw new YamlError(`'${text}' isn't a boolean`)
      return value
    }
    case INT:
      return constructInt(text)
    case FLOAT:
      return constructFloat(text)
    case TIMESTAMP:
      return constructTimestamp(text)
    case `${TAG}binary`:
      throw new YamlError("!!binary isn't supported in a sheet")
    default:
      throw new YamlError(`could not determine a constructor for the tag '${tag}'`)
  }
}

const kindOf = (node) => (isMap(node) ? 'mapping' : isSeq(node) ? 'sequence' : 'scalar')

/** A mapping's pairs with its merge keys (`<<`) resolved, in PyYAML's order
 * (constructor.py, flatten_mapping): what is merged comes first, so the
 * mapping's own keys win, and of a list of merged mappings the first wins. */
function flatten(node) {
  const merged = []
  const own = []
  for (const pair of node.items) {
    const key = pair.key
    const tag = isScalar(key) ? scalarTag(key) : null
    if (tag !== MERGE) {
      own.push([key, pair.value, tag === VALUE])
      continue
    }
    const value = pair.value
    if (isMap(value)) merged.push(...flatten(value))
    else if (isSeq(value)) {
      const each = value.items.map((item) => {
        if (!isMap(item)) throw new YamlError(`expected a mapping for merging, but found ${kindOf(item)}`)
        return flatten(item)
      })
      for (const pairs of each.reverse()) merged.push(...pairs)
    } else {
      throw new YamlError(`expected a mapping or list of mappings for merging, but found ${kindOf(value)}`)
    }
  }
  return [...merged, ...own]
}

function construct(node) {
  // A key without a value (`{a}`) has no node at all.
  if (node === null || node === undefined) return null
  if (isScalar(node)) return constructScalar(node)
  if (!SUPPORTED_COLLECTION_TAGS.has(node.tag)) throw new YamlError(`${node.tag.replace(TAG, '!!')} isn't supported in a sheet`)
  if (isSeq(node)) return node.items.map(construct)
  const dict = new PyDict()
  for (const [keyNode, valueNode, isValueKey] of flatten(node)) {
    // `=` as a key is the string "=" (PyYAML's "value" key).
    const key = isValueKey ? String(keyNode.value) : construct(keyNode)
    dict.set(key, construct(valueNode))
  }
  return dict
}

/** The document a YAML source holds, as PyYAML's SafeLoader would build it.
 * Throws YamlError. Aliases (`*name`) are refused, as the backend refuses
 * them: a few nested ones expand to gigabytes. */
export function loadYaml(source) {
  const doc = parseDocument(source, { schema: 'failsafe', uniqueKeys: false })
  if (doc.errors.length) throw new YamlError(doc.errors[0].message.split('\n')[0])
  visit(doc, {
    Alias(_, node) {
      throw new YamlError(`aliases (*${node.source}) aren't supported in a sheet`)
    },
    Pair(_, pair) {
      // `: 1` with nothing before the colon: PyYAML refuses it, the `yaml`
      // package reads it as an empty key.
      const key = pair.key
      if (isScalar(key) && key.type === 'PLAIN' && key.value === '' && source[key.range[0]] === ':') {
        throw new YamlError("expected the node content, but found ':'")
      }
    }
  })
  try {
    return construct(doc.contents)
  } catch (e) {
    // A BigInt that isn't a number, or nesting deeper than the stack.
    if (e instanceof YamlError) throw e
    throw new YamlError(e.message)
  }
}
