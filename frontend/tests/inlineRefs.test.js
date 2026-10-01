import { describe, expect, it } from 'vitest'
import { parseDiceRef, parseInlineRef } from '@/utils/inlineRefs'

describe('parseDiceRef', () => {
  it('keeps regular formulas working', () => {
    expect(parseDiceRef('2d20+5')).toBe('2d20+5')
    expect(parseDiceRef('d%')).toBe('d%')
    expect(parseDiceRef('4d6kh3')).toBe('4d6kh3')
  })

  it('turns keywords into rolls only alongside a number or dice', () => {
    expect(parseDiceRef('adv+5')).toBe('adv+5')
    expect(parseDiceRef('hf+1d6')).toBe('hf+1d6')
    expect(parseDiceRef('hf')).toBeNull()
    expect(parseDiceRef('dis')).toBeNull()
    expect(parseDiceRef('adv+dis')).toBeNull()
  })

  it('accepts any formula behind an explicit roll: prefix', () => {
    expect(parseDiceRef('roll:hf')).toBe('hf')
    expect(parseDiceRef('ROLL: adv')).toBe('adv')
    expect(parseDiceRef('roll:2d6')).toBe('2d6')
    expect(parseDiceRef('roll:nope')).toBeNull()
  })

  it('leaves bare keywords as ordinary code', () => {
    expect(parseInlineRef('dis')).toBeNull()
    expect(parseInlineRef('roll:dis')).toEqual({ kind: 'dice', formula: 'dis' })
  })
})
