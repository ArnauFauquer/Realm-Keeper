// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

const { push, runInlineAction, renderMermaidIn, embedMounted, embedUnmounted } = vi.hoisted(() => ({
  push: vi.fn(),
  runInlineAction: vi.fn(),
  renderMermaidIn: vi.fn(),
  embedMounted: vi.fn(),
  embedUnmounted: vi.fn()
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/api/auth', () => ({ getCurrentUser: vi.fn(), logout: vi.fn(), loginUrl: () => '' }))
vi.mock('@/api/http', () => ({ post: vi.fn() }))
vi.mock('@/composables/useSoundEffects', async () => {
  const { reactive } = await import('vue')
  const playing = reactive({})
  return { useSoundEffects: () => ({ playing }) }
})
vi.mock('@/composables/useMermaid', () => ({ renderMermaidIn }))
vi.mock('@/composables/useInlineActions', async (importOriginal) => ({
  ...(await importOriginal()),
  runInlineAction
}))
vi.mock('@/components/DocumentEmbed.vue', async () => {
  const { defineComponent, h, onMounted, onBeforeUnmount } = await import('vue')
  return {
    default: defineComponent({
      props: ['type', 'id', 'canInteract'],
      setup(props) {
        onMounted(() => embedMounted({ ...props }))
        onBeforeUnmount(() => embedUnmounted(props.id))
        return () => h('div', { class: 'stub-embed' }, `${props.type}:${props.id}`)
      }
    })
  }
})

const MarkdownBody = (await import('@/components/MarkdownBody.vue')).default
const { useAuth } = await import('@/composables/useAuth')
const { renderNote } = await import('@/utils/renderNote')

const NOTE = renderNote([
  '# Hall',
  '',
  'See [the hero](/note/People/The%20Hero) and roll `2d6`.',
  '',
  '`chart:maps/town`',
  '',
  '![map](/maps/hall.png)',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```'
].join('\n')).html

let wrapper
const click = (el, init = {}) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))

beforeEach(() => {
  vi.clearAllMocks()
  useAuth().user.value = null
})

afterEach(() => wrapper?.unmount())

describe('MarkdownBody', () => {
  it('routes note links inside the app, but leaves modified clicks to the browser', async () => {
    wrapper = mount(MarkdownBody, { props: { html: NOTE }, attachTo: document.body })
    const link = wrapper.element.querySelector('a[data-note-link]')

    expect(click(link)).toBe(false)
    expect(push).toHaveBeenCalledWith('/note/People/The%20Hero')

    push.mockClear()
    expect(click(link, { ctrlKey: true })).toBe(true)
    expect(push).not.toHaveBeenCalled()
  })

  it('emits the hovered note id, decoded, for prefetching', () => {
    wrapper = mount(MarkdownBody, { props: { html: NOTE } })
    wrapper.element.querySelector('a[data-note-link]').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(wrapper.emitted('link-hover')[0]).toEqual(['People/The Hero'])
  })

  it('plays nothing for a signed-out reader, and plays once someone signs in', async () => {
    wrapper = mount(MarkdownBody, { props: { html: NOTE } })
    click(wrapper.element.querySelector('[data-dice-formula]'))
    expect(runInlineAction).not.toHaveBeenCalled()
    expect(wrapper.element.querySelector('.img-screen-btn')).toBeNull()

    useAuth().user.value = { email: 'gm@example.com' }
    await nextTick()

    click(wrapper.element.querySelector('[data-dice-formula]'))
    expect(runInlineAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dice', value: '2d6' }))
    expect(wrapper.element.querySelector('.img-screen-btn')).not.toBeNull()
  })

  it('presses role="button" placeholders with Enter', async () => {
    useAuth().user.value = { email: 'gm@example.com' }
    wrapper = mount(MarkdownBody, { props: { html: NOTE } })
    wrapper.element.querySelector('[data-dice-formula]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(runInlineAction).toHaveBeenCalledTimes(1)
  })

  it('mounts embeds again with the new sign-in state, and unmounts them when the HTML goes', async () => {
    wrapper = mount(MarkdownBody, { props: { html: NOTE } })
    await nextTick()
    expect(embedMounted).toHaveBeenLastCalledWith({ type: 'chart', id: 'maps/town', canInteract: false })

    useAuth().user.value = { email: 'gm@example.com' }
    await nextTick()
    await nextTick()
    expect(embedUnmounted).toHaveBeenCalledWith('maps/town')
    expect(embedMounted).toHaveBeenLastCalledWith({ type: 'chart', id: 'maps/town', canInteract: true })

    embedUnmounted.mockClear()
    await wrapper.setProps({ html: '<p>Nothing here</p>' })
    expect(embedUnmounted).toHaveBeenCalledWith('maps/town')
  })

  it('draws diagrams only for HTML that has one', async () => {
    wrapper = mount(MarkdownBody, { props: { html: '<p>plain</p>' } })
    expect(renderMermaidIn).not.toHaveBeenCalled()
    await wrapper.setProps({ html: NOTE })
    expect(renderMermaidIn).toHaveBeenCalledTimes(1)
  })

  // The editor's Cancel brings the note back with HTML that didn't change.
  it('sets everything up again when shown again with the same HTML', async () => {
    const Host = defineComponent({
      props: ['show'],
      setup: (props) => () => (props.show ? h(MarkdownBody, { html: NOTE }) : h('textarea'))
    })
    wrapper = mount(Host, { props: { show: true } })
    await nextTick()
    expect(embedMounted).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ show: false })
    await wrapper.setProps({ show: true })
    await nextTick()
    expect(wrapper.element.querySelector('h1#hall')).not.toBeNull()
    expect(embedMounted).toHaveBeenCalledTimes(2)
  })
})
