// The icon font in src/assets/mdi holds only the icons the source uses. This
// fails when one is used that it lacks: run `python3 scripts/subset-mdi.py`.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = join(__dirname, '..', 'src')
const subset = readFileSync(join(src, 'assets', 'mdi', 'materialdesignicons-subset.css'), 'utf8')
const defined = new Set([...subset.matchAll(/^\.(mdi-[a-z0-9-]+)(?:::before|:before| |,)/gm)].map((m) => m[1]))

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== 'assets') yield* sources(path)
    } else if (/\.(vue|js|css)$/.test(name)) yield path
  }
}

describe('the icon subset', () => {
  it('has every icon the source uses', () => {
    const used = new Set()
    for (const file of sources(src)) {
      for (const token of readFileSync(file, 'utf8').matchAll(/\bmdi-[a-z0-9]+(?:-[a-z0-9]+)*/g)) used.add(token[0])
    }
    // A token that is a class of the stylesheet's own (size, spin) is in `defined` too.
    const missing = [...used].filter((name) => !defined.has(name))
    expect(missing, 'run python3 scripts/subset-mdi.py').toEqual([])
  })
})
