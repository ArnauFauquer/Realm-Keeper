// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount as vtuMount } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  user: null, kinds: [],
  slot: { doc: { id: 'x', name: 'Bugboar', sheet: { sections: [] } }, id: 'x', markDirty: vi.fn(), setAsset: vi.fn() }
}))
vi.mock('@/composables/useAuth', async () => {
  const { ref } = await import('vue')
  m.user = ref({ name: 'GM' })
  return { useAuth: () => ({ user: m.user }) }
})
vi.mock('@/composables/useDocModal', () => ({
  useDocModal: (kind) => { m.kinds.push(kind); return { isOpen: { value: false } } }
}))
vi.mock('@/api/docs', () => ({
  charactersApi: { name: 'characters' }, encountersApi: { name: 'encounters' },
  adversariesApi: { name: 'adversaries' }, vistasApi: { name: 'vistas' }
}))
vi.mock('@/components/DocumentModal.vue', () => ({
  default: defineComponent({
    name: 'DocumentModal',
    props: ['kind', 'modal', 'api', 'canEdit'],
    render() { return h('div', { class: 'doc-modal' }, this.$slots.editor?.(m.slot)) }
  })
}))
const editor = (name) => ({
  default: defineComponent({
    name,
    props: ['characterId', 'encounterId', 'canInteract', 'id', 'modelValue', 'type', 'name', 'canEdit', 'vista', 'editable'],
    emits: ['update:modelValue', 'change', 'set-background'],
    render() { return h('div', { class: `ed-${name}` }) }
  })
})
vi.mock('@/components/CharacterEditor.vue', () => editor('CharacterEditor'))
vi.mock('@/components/EncounterTracker.vue', () => editor('EncounterTracker'))
vi.mock('@/components/SheetEditor.vue', () => editor('SheetEditor'))
vi.mock('@/components/VistaCanvas.vue', () => editor('VistaCanvas'))

const { default: CharactersModal } = await import('@/components/CharactersModal.vue')
const { default: EncountersModal } = await import('@/components/EncountersModal.vue')
const { default: AdversariesModal } = await import('@/components/AdversariesModal.vue')
const { default: VistasModal } = await import('@/components/VistasModal.vue')

const mounted = []
const mount = (component) => { const w = vtuMount(component); mounted.push(w); return w }
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })
beforeEach(() => {
  m.user.value = { name: 'GM' }
  m.kinds.length = 0
  m.slot.markDirty.mockReset()
  m.slot.setAsset.mockReset()
})

const modalOf = (w) => w.findComponent({ name: 'DocumentModal' })

describe('CharactersModal', () => {
  it('lists characters and plays the sheet of the one opened', () => {
    const w = mount(CharactersModal)
    expect(m.kinds).toContain('character')
    expect(modalOf(w).props('kind').type).toBe('character')
    expect(modalOf(w).props('api')).toEqual({ name: 'characters' })
    expect(w.findComponent({ name: 'CharacterEditor' }).props()).toMatchObject({ characterId: 'x', canInteract: true })
  })

  it('is read-only for a visitor', () => {
    m.user.value = null
    const w = mount(CharactersModal)
    expect(modalOf(w).props('canEdit')).toBe(false)
    expect(w.findComponent({ name: 'CharacterEditor' }).props('canInteract')).toBe(false)
  })
})

describe('EncountersModal', () => {
  it('lists encounters and tracks the one opened', () => {
    const w = mount(EncountersModal)
    expect(m.kinds).toContain('encounter')
    expect(modalOf(w).props('kind').type).toBe('encounter')
    expect(modalOf(w).props('api')).toEqual({ name: 'encounters' })
    expect(w.findComponent({ name: 'EncounterTracker' }).props()).toMatchObject({ encounterId: 'x', canInteract: true })
  })

  it('is read-only for a visitor', () => {
    m.user.value = null
    const w = mount(EncountersModal)
    expect(modalOf(w).props('canEdit')).toBe(false)
    expect(w.findComponent({ name: 'EncounterTracker' }).props('canInteract')).toBe(false)
  })
})

describe('AdversariesModal', () => {
  it('edits the adversary sheet and marks the document changed on every edit', async () => {
    const w = mount(AdversariesModal)
    expect(m.kinds).toContain('adversary')
    expect(modalOf(w).props('api')).toEqual({ name: 'adversaries' })
    const sheet = w.findComponent({ name: 'SheetEditor' })
    expect(sheet.props()).toMatchObject({ id: 'x', type: 'adversary', name: 'Bugboar', canEdit: true })
    await sheet.vm.$emit('update:modelValue', { sections: [1] })
    expect(m.slot.markDirty).toHaveBeenCalled()
  })

  it('is read-only for a visitor', () => {
    m.user.value = null
    const w = mount(AdversariesModal)
    expect(modalOf(w).props('canEdit')).toBe(false)
    expect(w.findComponent({ name: 'SheetEditor' }).props('canEdit')).toBe(false)
  })
})

describe('VistasModal', () => {
  it('draws the vista, marks it changed and sets its background through the modal', async () => {
    const w = mount(VistasModal)
    expect(m.kinds).toContain('vista')
    expect(modalOf(w).props('kind').type).toBe('vista')
    const canvas = w.findComponent({ name: 'VistaCanvas' })
    expect(canvas.props()).toMatchObject({ vista: { id: 'x' }, editable: true })
    await canvas.vm.$emit('change')
    expect(m.slot.markDirty).toHaveBeenCalled()
    await canvas.vm.$emit('set-background', '/bg.png')
    expect(m.slot.setAsset).toHaveBeenCalledWith('background', '/bg.png')
  })

  it('is read-only for a visitor', () => {
    m.user.value = null
    const w = mount(VistasModal)
    expect(modalOf(w).props('canEdit')).toBe(false)
    expect(w.findComponent({ name: 'VistaCanvas' }).props('editable')).toBe(false)
  })
})
