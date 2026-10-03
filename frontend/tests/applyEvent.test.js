import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { applyEvent } from '@/utils/applyEvent'

// The cases backend/tests/test_docs.py checks diff_docs against: an event the
// server makes from `old` and `new` must turn `old` into `new` here.
const cases = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../backend/tests/fixtures/events.json', import.meta.url)), 'utf-8')
)

describe('applyEvent', () => {
  it('finds the shared cases', () => {
    expect(cases.length).toBeGreaterThan(3)
  })

  it.each(cases.map((c) => [c.name, c]))('%s', (_name, { old, new: expected, event }) => {
    expect(applyEvent(structuredClone(old), event)).toEqual(expected)
  })

  it('records the rev the change brought the document to', () => {
    const doc = applyEvent({ rev: 3, count: 0 }, { rev: 4, set: { count: 1 } })
    expect(doc).toEqual({ rev: 4, count: 1 })
  })

  it('creates a list that was not there yet', () => {
    expect(applyEvent({}, { upsert: { combatants: [{ id: 'a' }] } })).toEqual({ combatants: [{ id: 'a' }] })
  })

  it('ignores an id in `order` it does not have', () => {
    const doc = applyEvent({ list: [{ id: 'a' }] }, { order: { list: ['b', 'a'] } })
    expect(doc.list).toEqual([{ id: 'a' }])
  })
})
