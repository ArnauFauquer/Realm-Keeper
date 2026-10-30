import { describe, expect, it, vi } from 'vitest'
import { random } from '../src/utils/random.js'

describe('random', () => {
  it('is in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('does not repeat itself', () => {
    expect(new Set(Array.from({ length: 500 }, random)).size).toBeGreaterThan(490)
  })

  it('draws from the Web Crypto generator, in batches', () => {
    const spy = vi.spyOn(globalThis.crypto, 'getRandomValues')
    for (let i = 0; i < 600; i++) random()
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(spy.mock.calls.length).toBeLessThanOrEqual(4)
    spy.mockRestore()
  })
})
