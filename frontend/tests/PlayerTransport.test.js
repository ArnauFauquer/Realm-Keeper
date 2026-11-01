// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const player = vi.hoisted(() => ({}))
vi.mock('@/composables/usePlayer', async () => {
  const { ref } = await import('vue')
  Object.assign(player, {
    isPlaying: ref(false), isShuffle: ref(false), isRepeat: ref(false),
    togglePlay: vi.fn(), playNext: vi.fn(), playPrev: vi.fn(), toggleShuffle: vi.fn(), toggleRepeat: vi.fn()
  })
  return { usePlayer: () => player }
})
const PlayerTransport = (await import('@/components/PlayerTransport.vue')).default

describe('PlayerTransport', () => {
  it('drives the shared player from its five buttons', async () => {
    const w = mount(PlayerTransport)
    await w.find('[aria-label="Shuffle"]').trigger('click')
    await w.find('[aria-label="Previous track"]').trigger('click')
    await w.find('.play-btn').trigger('click')
    await w.find('[aria-label="Next track"]').trigger('click')
    await w.find('[aria-label="Repeat"]').trigger('click')
    for (const fn of [player.toggleShuffle, player.playPrev, player.togglePlay, player.playNext, player.toggleRepeat]) {
      expect(fn).toHaveBeenCalledTimes(1)
    }
  })

  it('shows play or pause, and pressed shuffle/repeat', async () => {
    const w = mount(PlayerTransport)
    expect(w.find('.play-btn').attributes('aria-label')).toBe('Play')
    expect(w.find('.mdi-play').exists()).toBe(true)
    player.isPlaying.value = true
    player.isShuffle.value = true
    player.isRepeat.value = true
    await w.vm.$nextTick()
    expect(w.find('.play-btn').attributes('aria-label')).toBe('Pause')
    expect(w.find('[aria-label="Shuffle"]').attributes('aria-pressed')).toBe('true')
    expect(w.find('[aria-label="Repeat"]').classes()).toContain('is-active')
  })

  it('has a compact version with small buttons', () => {
    const w = mount(PlayerTransport, { props: { compact: true } })
    expect(w.classes()).toContain('player-transport--compact')
    expect(w.find('[aria-label="Shuffle"]').classes()).toContain('rk-icon-btn--sm')
    expect(mount(PlayerTransport).find('[aria-label="Shuffle"]').classes()).not.toContain('rk-icon-btn--sm')
  })
})
