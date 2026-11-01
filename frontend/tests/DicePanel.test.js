// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const dice = vi.hoisted(() => ({}))
vi.mock('@/composables/useDiceRoller', async () => {
  const { reactive } = await import('vue')
  dice.state = reactive({ isPanelOpen: true, isRolling: false })
  dice.roll = vi.fn().mockResolvedValue({})
  dice.closePanel = vi.fn()
  return { useDiceRoller: () => dice }
})
const DicePanel = (await import('@/components/DicePanel.vue')).default

const make = () => mount(DicePanel)
const row = (w, label) => w.findAll('.die-row').find((r) => r.find('.die-label').text() === label)
const add = (w, label, times = 1) => Promise.all(Array.from({ length: times }, () => row(w, label).find(`[aria-label="Add one ${label}"]`).trigger('click')))
const remove = (w, label) => row(w, label).find(`[aria-label="Remove one ${label}"]`).trigger('click')
const rollBtn = (w) => w.find('.roll-btn')

beforeEach(() => {
  dice.state.isPanelOpen = true
  dice.state.isRolling = false
  dice.roll.mockClear()
  dice.closePanel.mockClear()
})

describe('DicePanel', () => {
  it('is not drawn while closed', () => {
    dice.state.isPanelOpen = false
    expect(make().find('.dice-panel-card').exists()).toBe(false)
  })

  it('closes when the backdrop is clicked, but not the card', async () => {
    const w = make()
    await w.find('.dice-panel-card').trigger('click')
    expect(dice.closePanel).not.toHaveBeenCalled()
    await w.find('.dice-panel-overlay').trigger('click')
    expect(dice.closePanel).toHaveBeenCalled()
  })

  it('cannot roll with nothing selected', () => {
    expect(rollBtn(make()).attributes('disabled')).toBeDefined()
  })

  it('builds a formula from the dice picked, and rolls it', async () => {
    const w = make()
    await add(w, 'd8', 2)
    await add(w, 'd6')
    expect(rollBtn(w).text()).toContain('Roll')
    expect(rollBtn(w).text()).toMatch(/2d8/)
    await w.find('[aria-label="Increase modifier"]').trigger('click')
    await w.find('[aria-label="Increase modifier"]').trigger('click')
    expect(w.find('.modifier-row .stepper-value').text()).toBe('+2')
    await rollBtn(w).trigger('click')
    const formula = dice.roll.mock.calls[0][0]
    expect(formula).toMatch(/2d8/)
    expect(formula).toMatch(/1d6/)
    expect(formula.endsWith('+2')).toBe(true)
  })

  it('subtracts dice with a negative count and a negative modifier', async () => {
    const w = make()
    await add(w, 'd20')
    await remove(w, 'd4')
    await w.find('[aria-label="Decrease modifier"]').trigger('click')
    await rollBtn(w).trigger('click')
    const formula = dice.roll.mock.calls[0][0]
    expect(formula).toContain('1d20')
    expect(formula).toContain('-1d4')
    expect(formula.endsWith('-1')).toBe(true)
  })

  it('stops at 20 dice of a kind', async () => {
    const w = make()
    await add(w, 'd6', 20)
    expect(row(w, 'd6').find('.stepper-value').text()).toBe('20')
    expect(row(w, 'd6').find('[aria-label="Add one d6"]').attributes('disabled')).toBeDefined()
    await add(w, 'd6')
    expect(row(w, 'd6').find('.stepper-value').text()).toBe('20')
    for (let i = 0; i < 41; i++) await remove(w, 'd6')
    expect(row(w, 'd6').find('.stepper-value').text()).toBe('-20')
    expect(row(w, 'd6').find('[aria-label="Remove one d6"]').attributes('disabled')).toBeDefined()
  })

  it('refuses a selection of more dice than can be thrown', async () => {
    const w = make()
    for (const label of ['d4', 'd6', 'd8']) await add(w, label, 20)
    expect(rollBtn(w).text()).toContain('Too many dice')
    expect(rollBtn(w).attributes('disabled')).toBeDefined()
    await rollBtn(w).trigger('click')
    expect(dice.roll).not.toHaveBeenCalled()
  })

  it('rolls Hope & Fear on its own', async () => {
    const w = make()
    await w.find('.duality-toggle').trigger('click')
    expect(w.find('.duality-toggle').attributes('aria-pressed')).toBe('true')
    await rollBtn(w).trigger('click')
    expect(dice.roll).toHaveBeenCalledWith('hf')
  })

  it('toggles advantage on a single d20, and drops it when the d20 count changes', async () => {
    const w = make()
    const [adv, dis] = w.findAll('.d20-mode-btn')
    await adv.trigger('click')
    expect(row(w, 'd20').find('.stepper-value').text()).toBe('1')
    expect(adv.attributes('aria-pressed')).toBe('true')
    await rollBtn(w).trigger('click')
    expect(dice.roll).toHaveBeenLastCalledWith('adv')
    await dis.trigger('click')
    await rollBtn(w).trigger('click')
    expect(dice.roll).toHaveBeenLastCalledWith('dis')
    await dis.trigger('click')
    expect(dis.attributes('aria-pressed')).toBe('false')
    await adv.trigger('click')
    await add(w, 'd20')
    expect(adv.attributes('aria-pressed')).toBe('false')
  })

  it('clears the whole selection', async () => {
    const w = make()
    await add(w, 'd10', 3)
    await w.find('.duality-toggle').trigger('click')
    await w.find('[aria-label="Increase modifier"]').trigger('click')
    await w.find('[aria-label="Clear selection"]').trigger('click')
    expect(row(w, 'd10').find('.stepper-value').text()).toBe('0')
    expect(w.find('.duality-toggle').attributes('aria-pressed')).toBe('false')
    expect(w.find('.modifier-row .stepper-value').text()).toBe('0')
    expect(rollBtn(w).attributes('disabled')).toBeDefined()
  })

  it('rolls a typed formula only when it is valid', async () => {
    const w = make()
    const input = w.find('.formula-input')
    expect(w.find('.formula-submit').attributes('disabled')).toBeDefined()
    await input.setValue('banana')
    expect(input.classes()).toContain('invalid')
    await w.find('form').trigger('submit')
    expect(dice.roll).not.toHaveBeenCalled()
    await input.setValue('4d8+5')
    expect(input.classes()).not.toContain('invalid')
    await w.find('form').trigger('submit')
    expect(dice.roll).toHaveBeenCalledWith('4d8+5')
  })

  it('cannot roll while a roll is in flight', async () => {
    const w = make()
    await add(w, 'd6')
    await w.find('.formula-input').setValue('1d6')
    dice.state.isRolling = true
    await w.vm.$nextTick()
    expect(rollBtn(w).attributes('disabled')).toBeDefined()
    expect(w.find('.formula-submit').attributes('disabled')).toBeDefined()
  })
})
