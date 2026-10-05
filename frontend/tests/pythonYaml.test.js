import { describe, it, expect } from 'vitest'
import { loadYaml, pyRepr, pyStr, PyDict, PyFloat, toJson, YamlError } from '@/utils/pythonYaml'

// What PyYAML's SafeLoader and Python's str() make of these (checked against
// the backend; the sheet fixtures in backend/tests/fixtures/sheets/ cover the
// same through whole sheets).
const value = (yaml) => loadYaml(`v: ${yaml}\n`).get('v')

describe('loadYaml reads scalars as YAML 1.1, like PyYAML', () => {
  it.each([
    ['yes', 'True'],
    ['Off', 'False'],
    ['y', 'y'],
    ['tRue', 'tRue'],
    ['1.0', '1.0'],
    ['-.5', '-.5'],
    ['.5', '0.5'],
    ['010', '8'],
    ['08', '08'],
    ['-0', '0'],
    ['0x_1f', '31'],
    ['+0b11', '3'],
    ['1_000', '1000'],
    ['1e3', '1e3'],
    ['1.0e3', '1.0e3'],
    ['1.0e+3', '1000.0'],
    ['1:30', '90'],
    ['1:60', '1:60'],
    ['1:30.5', '90.5'],
    ['.Inf', 'inf'],
    ['-.inf', '-inf'],
    ['.nan', 'nan'],
    ['~', 'None'],
    ['nUll', 'nUll'],
    ['2024-01-01', '2024-01-01'],
    ['2024-1-1', '2024-1-1'],
    ['2024-1-1 1:20:30', '2024-01-01 01:20:30'],
    ['2024-01-01T10:20:30Z', '2024-01-01 10:20:30+00:00'],
    ['2024-01-01 10:20:30.1234567 -5', '2024-01-01 10:20:30.123456-05:00'],
    ["'yes'", 'yes'],
    ['! yes', 'True'],
    ['!!str 5', '5'],
    ["!!float '2'", '2.0']
  ])('%s -> %s', (yaml, text) => {
    expect(pyStr(value(yaml))).toBe(text)
  })

  it('keeps a whole float a float, and a big int exact', () => {
    expect(value('6.0')).toEqual(new PyFloat(6))
    expect(value('6')).toBe(6)
    expect(value('99999999999999999999')).toBe(99999999999999999999n)
  })

  it('refuses what PyYAML has no constructor for', () => {
    expect(() => value('=')).toThrow(YamlError)
    expect(() => value('<<')).toThrow(YamlError)
    expect(() => value('!foo x')).toThrow(/constructor/)
    expect(() => value('2023-02-29')).toThrow(YamlError)
    expect(() => value('!!int abc')).toThrow(YamlError)
  })
})

describe('mappings, as Python dicts', () => {
  it('keeps the last of a duplicated key, where the first one was', () => {
    const dict = loadYaml('a: 1\nb: 2\na: 3\n')
    expect(dict.entries()).toEqual([['a', 3], ['b', 2]])
  })

  it('treats 1, 1.0 and true as one key, kept as first written', () => {
    expect(pyStr(value('{yes: no, 1: 1.0, ~: x}'))).toBe("{True: 1.0, None: 'x'}")
  })

  it('keeps keys that look like numbers in their order', () => {
    expect(loadYaml('10: a\n2: b\n').entries().map(([k]) => k)).toEqual([10, 2])
  })

  it('merges <<: own keys win, and the first of a list of merged mappings', () => {
    const dict = loadYaml('own: 1\n<<: [{own: 2, a: first}, {a: second, b: 3}]\n')
    expect(dict.entries()).toEqual([['a', 'first'], ['b', 3], ['own', 1]])
    expect(() => loadYaml('<<: 3\n')).toThrow(/merging/)
  })

  it('refuses aliases, keys that are lists, and an empty key', () => {
    expect(() => loadYaml('a: &x 1\nb: *x\n')).toThrow(/aliases \(\*x\)/)
    expect(() => loadYaml('? [a, b]\n: c\n')).toThrow(/unhashable/)
    expect(() => loadYaml('a: 1\n: 2\n')).toThrow(YamlError)
  })

  it('reads an explicit empty key as None, as PyYAML does', () => {
    expect(loadYaml('?\n: x\n').entries()).toEqual([[null, 'x']])
  })
})

describe('pyRepr and pyStr write values as Python does', () => {
  it.each([
    [12345678901234567.0, '1.2345678901234568e+16'],
    [1e16, '1e+16'],
    [1e15, '1000000000000000.0'],
    [0.0001, '0.0001'],
    [0.00001, '1e-05'],
    [1.5e-300, '1.5e-300'],
    [-0, '-0.0'],
    [100, '100.0'],
    [0.1 + 0.2, '0.30000000000000004']
  ])('the float %s is %s', (x, text) => {
    expect(pyRepr(new PyFloat(x))).toBe(text)
  })

  it('quotes strings as repr() does', () => {
    expect(pyRepr("it's")).toBe('"it\'s"')
    expect(pyRepr('a\'b"c')).toBe("'a\\'b\"c'")
    expect(pyRepr('tab\there\x01\x7f­​😀é')).toBe("'tab\\there\\x01\\x7f\\xad\\u200b😀é'")
  })

  it('writes lists, dicts and dates', () => {
    expect(pyStr(value('[a, "b\'c", 1.5, null, true]'))).toBe('[\'a\', "b\'c", 1.5, None, True]')
    expect(pyStr(value('{a: 1, 2: [x]}'))).toBe("{'a': 1, 2: ['x']}")
    expect(pyStr(value('[2024-01-01, 2024-01-01 10:00:00, 2024-01-01 10:00:00+02:00]'))).toBe(
      '[datetime.date(2024, 1, 1), datetime.datetime(2024, 1, 1, 10, 0), ' +
        'datetime.datetime(2024, 1, 1, 10, 0, tzinfo=datetime.timezone(datetime.timedelta(seconds=7200)))]'
    )
  })
})

describe('toJson', () => {
  it('gives what the backend API sends', () => {
    const dict = new PyDict()
    dict.set(1, new PyFloat(1))
    dict.set(true, 'ignored key, same as 1')
    dict.set(null, [value('2024-01-01')])
    expect(toJson(dict)).toEqual({ 1: 'ignored key, same as 1', null: ['2024-01-01'] })
  })
})
