<template>
  <div class="player-transport" :class="{ 'player-transport--compact': compact }">
    <button
      class="rk-icon-btn"
      :class="[buttonSize, { 'is-active': isShuffle }]"
      title="Shuffle"
      aria-label="Shuffle"
      :aria-pressed="isShuffle"
      @click="toggleShuffle"
    >
      <span class="mdi mdi-shuffle-variant"></span>
    </button>
    <button class="rk-icon-btn" :class="buttonSize" title="Previous" aria-label="Previous track" @click="playPrev">
      <span class="mdi mdi-skip-previous"></span>
    </button>
    <button
      class="play-btn"
      :title="isPlaying ? 'Pause' : 'Play'"
      :aria-label="isPlaying ? 'Pause' : 'Play'"
      @click="togglePlay"
    >
      <span class="mdi" :class="isPlaying ? 'mdi-pause' : 'mdi-play'"></span>
    </button>
    <button class="rk-icon-btn" :class="buttonSize" title="Next" aria-label="Next track" @click="playNext">
      <span class="mdi mdi-skip-next"></span>
    </button>
    <button
      class="rk-icon-btn"
      :class="[buttonSize, { 'is-active': isRepeat }]"
      title="Repeat"
      aria-label="Repeat"
      :aria-pressed="isRepeat"
      @click="toggleRepeat"
    >
      <span class="mdi mdi-repeat"></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { usePlayer } from '@/composables/usePlayer'

// The music player's transport (shuffle, previous, play/pause, next, repeat),
// driving the one shared player (usePlayer). `compact` is the small version
// for a sidebar: small buttons spread across the width.
const props = defineProps({
  compact: { type: Boolean, default: false }
})

const {
  isPlaying, isShuffle, isRepeat,
  togglePlay, playNext, playPrev, toggleShuffle, toggleRepeat
} = usePlayer()

const buttonSize = computed(() => props.compact && 'rk-icon-btn--sm')
</script>

<style scoped>
.player-transport {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}

.player-transport--compact {
  justify-content: space-between;
  gap: 0;
}

.play-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--control-md);
  height: var(--control-md);
  border: none;
  border-radius: var(--radius-full);
  background: var(--accent-strong);
  color: var(--accent-contrast);
  transition: background-color var(--duration-fast) var(--ease-out), transform var(--duration-fast) var(--ease-out);
}

.play-btn .mdi {
  font-size: 1.25rem;
}

.player-transport--compact .play-btn {
  box-shadow: var(--shadow-accent);
}

.player-transport--compact .play-btn .mdi {
  font-size: 1.3rem;
}

.play-btn:hover {
  background: var(--accent-strong-hover);
}

.play-btn:active {
  transform: scale(0.94);
}
</style>
