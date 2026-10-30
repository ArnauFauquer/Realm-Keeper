// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import TagsInput from '@/components/TagsInput.vue'

const make = (props = {}) => mount(TagsInput, { props: { modelValue: ['npc'], ...props } })
const emitted = (w) => w.emitted('update:modelValue')

describe('TagsInput', () => {
  it('shows each tag as a chip, and the placeholder only when empty', () => {
    const w = make({ modelValue: ['a', 'b'] })
    expect(w.findAll('.tags-chip').map((c) => c.text())).toEqual(['a', 'b'])
    expect(w.find('input').attributes('placeholder')).toBe('')
    expect(make({ modelValue: [] }).find('input').attributes('placeholder')).toBe('Add a tag')
  })

  it('adds a tag on Enter, trimmed, and clears the field', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('  place ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(emitted(w)[0][0]).toEqual(['npc', 'place'])
    expect(input.element.value).toBe('')
  })

  it('adds on a comma, and splits a pasted list', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('x')
    await input.trigger('keydown', { key: ',' })
    expect(emitted(w)[0][0]).toEqual(['npc', 'x'])
    await input.setValue('a, b ,, c')
    await input.trigger('blur')
    expect(emitted(w)[1][0]).toEqual(['npc', 'a', 'b', 'c'])
  })

  it('ignores blanks and tags it already has', async () => {
    const w = make()
    const input = w.find('input')
    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    await input.setValue('npc')
    await input.trigger('keydown', { key: 'Enter' })
    expect(emitted(w)).toBeUndefined()
  })

  it('removes a tag with its button', async () => {
    const w = make({ modelValue: ['a', 'b', 'c'] })
    await w.findAll('.tags-remove')[1].trigger('click')
    expect(emitted(w)[0][0]).toEqual(['a', 'c'])
  })

  it('takes the last tag back into the field on Backspace in an empty field', async () => {
    const w = make({ modelValue: ['a', 'b'] })
    const input = w.find('input')
    await input.trigger('keydown', { key: 'Backspace' })
    expect(emitted(w)[0][0]).toEqual(['a'])
    expect(input.element.value).toBe('b')
  })

  it('leaves Backspace alone when the field has text or there are no tags', async () => {
    const w = make({ modelValue: ['a'] })
    await w.find('input').setValue('x')
    await w.find('input').trigger('keydown', { key: 'Backspace' })
    expect(emitted(w)).toBeUndefined()
    const empty = make({ modelValue: [] })
    await empty.find('input').trigger('keydown', { key: 'Backspace' })
    expect(emitted(empty)).toBeUndefined()
  })

  it('disables the field and the remove buttons', () => {
    const w = make({ disabled: true })
    expect(w.find('input').attributes('disabled')).toBeDefined()
    expect(w.find('.tags-remove').attributes('disabled')).toBeDefined()
    expect(w.classes()).toContain('is-disabled')
  })

  it('labels the field for assistive tech', () => {
    expect(make({ label: 'Sheet tags' }).find('input').attributes('aria-label')).toBe('Sheet tags')
  })
})
