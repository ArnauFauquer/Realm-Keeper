// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const dice = vi.hoisted(() => ({}))
vi.mock('@/composables/useDiceRoller', async () => {
  const { reactive } = await import('vue')
  dice.state = reactive({ isPanelOpen: false, isRolling: false, overlayVisible: false, toasts: [] })
  Object.assign(dice, {
    togglePanel: vi.fn(), dismissToast: vi.fn(), registerCanvas: vi.fn(), resizeWorld: vi.fn(), disposeWorld: vi.fn()
  })
  return { useDiceRoller: () => dice }
})

const DiceFab = (await import('@/components/DiceFab.vue')).default
const DiceOverlay = (await import('@/components/DiceOverlay.vue')).default
const DiceToastStack = (await import('@/components/DiceToastStack.vue')).default

beforeEach(() => {
  Object.assign(dice.state, { isPanelOpen: false, isRolling: false, overlayVisible: false, toasts: [] })
  Object.values(dice).forEach((v) => v?.mockClear?.())
})

describe('DiceFab', () => {
  it('toggles the panel, and shows a close icon while it is open', async () => {
    const w = mount(DiceFab)
    expect(w.find('.mdi-dice-multiple').exists()).toBe(true)
    await w.trigger('click')
    expect(dice.togglePanel).toHaveBeenCalled()
    dice.state.isPanelOpen = true
    await w.vm.$nextTick()
    expect(w.find('.mdi-close').exists()).toBe(true)
    expect(w.classes()).toContain('is-open')
  })

  it('is disabled while rolling', async () => {
    dice.state.isRolling = true
    const w = mount(DiceFab)
    expect(w.attributes('disabled')).toBeDefined()
    expect(w.classes()).toContain('is-rolling')
  })
})

describe('DiceOverlay', () => {
  it('registers its canvas, follows window resizes and disposes the world on unmount', async () => {
    const w = mount(DiceOverlay)
    expect(dice.registerCanvas).toHaveBeenCalledWith(w.find('canvas').element)
    window.dispatchEvent(new Event('resize'))
    expect(dice.resizeWorld).toHaveBeenCalledWith(0, 0)
    dice.state.overlayVisible = true
    await w.vm.$nextTick()
    expect(w.classes()).toContain('visible')
    w.unmount()
    expect(dice.disposeWorld).toHaveBeenCalled()
    window.dispatchEvent(new Event('resize'))
    expect(dice.resizeWorld).toHaveBeenCalledTimes(1)
  })
})

describe('DiceToastStack', () => {
  const toast = (extra = {}) => ({
    id: 1, formula: '2d6+3', label: 'Bugboar · Gore', outcome: null,
    groups: [{ sides: 6, sign: 1, rolls: [2, 5] }], flatModifier: 3, total: 10, duality: null, natural: null, ...extra
  })

  it('draws a roll: label, formula, dice, modifier and total', () => {
    dice.state.toasts.push(toast())
    const w = mount(DiceToastStack)
    expect(w.find('.toast-label').text()).toBe('Bugboar · Gore')
    expect(w.find('.toast-formula').text()).toContain('2d6+3')
    expect(w.find('.toast-rolls').text()).toBe('[2, 5]')
    expect(w.find('.toast-flat').text()).toBe('+3')
    expect(w.find('.toast-total').text()).toBe('10')
    expect(w.find('.toast-table-row').exists()).toBe(false)
  })

  it('shows the signs of later and negative groups, and a negative modifier', () => {
    dice.state.toasts.push(toast({
      groups: [{ sides: 6, sign: 1, rolls: [1] }, { sides: 4, sign: -1, rolls: [3] }], flatModifier: -2
    }))
    const w = mount(DiceToastStack)
    expect(w.find('.toast-sign').text()).toBe('-')
    expect(w.find('.toast-flat').text()).toBe('-2')
  })

  it('names the duality outcome and Hope / Fear dice', () => {
    dice.state.toasts.push(toast({
      groups: [{ sides: 12, sign: 1, kind: 'hope', rolls: [7] }, { sides: 12, sign: 1, kind: 'fear', rolls: [3] }],
      duality: { outcome: 'hope' }
    }))
    const w = mount(DiceToastStack)
    expect(w.text()).toContain('Hope 7')
    expect(w.text()).toContain('Fear 3')
    expect(w.find('.toast-outcome').text()).toBe('with Hope')
    expect(w.find('.dice-toast').classes()).toContain('duality--hope')
  })

  it('flags a natural 20 and a natural 1', () => {
    dice.state.toasts.push(toast({ id: 1, groups: [{ sides: 20, sign: 1, rolls: [20] }], natural: { critical: true, fumble: false } }))
    dice.state.toasts.push(toast({ id: 2, groups: [{ sides: 20, sign: 1, rolls: [1] }], natural: { critical: false, fumble: true } }))
    const w = mount(DiceToastStack)
    const [crit, fumble] = w.findAll('.dice-toast')
    expect(crit.classes()).toContain('natural--crit')
    expect(crit.find('.outcome--crit').text()).toBe('Critical!')
    expect(crit.find('.nat--crit').exists()).toBe(true)
    expect(fumble.classes()).toContain('natural--fumble')
    expect(fumble.find('.outcome--fumble').text()).toBe('Fumble!')
  })

  it('shows what a roll table landed on, and dismisses a toast', async () => {
    dice.state.toasts.push(toast({ outcome: 'Two wolves' }))
    const w = mount(DiceToastStack)
    expect(w.find('.toast-table-row').text()).toBe('Two wolves')
    await w.find('.toast-close').trigger('click')
    expect(dice.dismissToast).toHaveBeenCalledWith(1)
  })
})
