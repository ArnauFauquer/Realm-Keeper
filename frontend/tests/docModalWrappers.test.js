// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount as vtuMount } from '@vue/test-utils'

const m = vi.hoisted(() => ({
  push: vi.fn(), user: null, isOpen: null, kinds: [],
  slot: { doc: { id: 'c1' }, id: 'c1', markDirty: vi.fn(), setAsset: vi.fn(), close: vi.fn() }
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: m.push }) }))
vi.mock('@/composables/useAuth', async () => {
  const { ref } = await import('vue')
  m.user = ref({ name: 'GM' })
  return { useAuth: () => ({ user: m.user }) }
})
vi.mock('@/composables/useDocModal', async () => {
  const { ref } = await import('vue')
  m.isOpen = ref(true)
  return { useDocModal: (kind) => { m.kinds.push(kind); return { isOpen: m.isOpen } } }
})
vi.mock('@/api/docs', () => ({ chartsApi: { name: 'charts' }, battlemapsApi: { name: 'battlemaps' } }))

// The modal itself is tested in DocumentModal.test.js: here it only hands over
// what the wrapper gave it, and renders the wrapper's editor.
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
    props: ['chart', 'editable', 'notes', 'battlemapId', 'canInteract'],
    emits: ['change', 'set-map-image', 'open-note'],
    render() { return h('div', { class: `ed-${name}` }) }
  })
})
vi.mock('@/components/ChartCanvas.vue', () => editor('ChartCanvas'))
vi.mock('@/components/BattlemapEditor.vue', () => editor('BattlemapEditor'))

const { default: ChartsModal } = await import('@/components/ChartsModal.vue')
const { default: BattlemapsModal } = await import('@/components/BattlemapsModal.vue')

// Every wrapper is unmounted after its test, so none keeps reacting to the
// next test's changes of the shared user.
const mounted = []
const mount = (...args) => { const w = vtuMount(...args); mounted.push(w); return w }
afterEach(() => { mounted.splice(0).forEach((w) => w.unmount()) })

beforeEach(() => {
  m.push.mockReset()
  m.user.value = { name: 'GM' }
  m.isOpen.value = true
  m.kinds.length = 0
  m.slot.markDirty.mockReset()
  m.slot.setAsset.mockReset()
  m.slot.close.mockReset()
})

describe('ChartsModal', () => {
  it('gives the document modal the chart kind and API, and edits only when signed in', () => {
    const w = mount(ChartsModal)
    const modal = w.findComponent({ name: 'DocumentModal' })
    expect(modal.props('kind').type).toBe('chart')
    expect(modal.props('api')).toEqual({ name: 'charts' })
    expect(modal.props('canEdit')).toBe(true)
    expect(m.kinds).toContain('chart')
  })

  it('does not let a visitor edit', () => {
    m.user.value = null
    expect(mount(ChartsModal).findComponent({ name: 'DocumentModal' }).props('canEdit')).toBe(false)
  })

  it('draws the chart in its canvas, and passes the notes for pins', () => {
    const notes = [{ id: 'a' }]
    const canvas = mount(ChartsModal, { props: { notes } }).findComponent({ name: 'ChartCanvas' })
    expect(canvas.props()).toMatchObject({ chart: { id: 'c1' }, editable: true, notes })
  })

  it('marks the chart changed and sets its map image through the modal', async () => {
    const canvas = mount(ChartsModal).findComponent({ name: 'ChartCanvas' })
    await canvas.vm.$emit('change')
    expect(m.slot.markDirty).toHaveBeenCalled()
    await canvas.vm.$emit('set-map-image', '/img.png')
    expect(m.slot.setAsset).toHaveBeenCalledWith('image', '/img.png')
  })

  it('goes to the note of a pin once the chart has closed', async () => {
    m.isOpen.value = false
    const canvas = mount(ChartsModal).findComponent({ name: 'ChartCanvas' })
    await canvas.vm.$emit('open-note', 'People/Mirela')
    expect(m.slot.close).toHaveBeenCalled()
    expect(m.push).toHaveBeenCalledWith('/note/People/Mirela')
  })

  it('stays on the chart when closing it was refused (unsaved changes)', async () => {
    m.isOpen.value = true
    const canvas = mount(ChartsModal).findComponent({ name: 'ChartCanvas' })
    await canvas.vm.$emit('open-note', 'People/Mirela')
    expect(m.slot.close).toHaveBeenCalled()
    expect(m.push).not.toHaveBeenCalled()
  })
})

describe('BattlemapsModal', () => {
  it('hands the battlemap kind and API to the document modal and edits it', () => {
    const w = mount(BattlemapsModal)
    const modal = w.findComponent({ name: 'DocumentModal' })
    expect(modal.props('kind').type).toBe('battlemap')
    expect(modal.props('api')).toEqual({ name: 'battlemaps' })
    expect(w.findComponent({ name: 'BattlemapEditor' }).props()).toMatchObject({ battlemapId: 'c1', canInteract: true })
  })

  it('lets a visitor look at a battlemap but not edit or interact with it', () => {
    m.user.value = null
    const anon = mount(BattlemapsModal)
    expect(anon.findComponent({ name: 'DocumentModal' }).props('canEdit')).toBe(false)
    expect(anon.findComponent({ name: 'BattlemapEditor' }).props('canInteract')).toBe(false)
  })
})
