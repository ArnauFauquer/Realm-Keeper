// What the encounter tracker's tests stand in for the live document with: a
// document they can set, and a `commit` that just waits for the command.
import { ref } from 'vue'
import { vi } from 'vitest'

export const doc = ref(null)
export const status = ref('ready')
export const error = ref(null)
export const commit = vi.fn((command) => Promise.resolve(command))

export const characters = {
  status: { value: 'ready' },
  stateOf: vi.fn(() => null),
  adjust: vi.fn(() => Promise.resolve({}))
}

export function reset(encounter) {
  doc.value = encounter
  status.value = 'ready'
  error.value = null
  commit.mockClear()
  characters.stateOf.mockReset().mockReturnValue(null)
  characters.adjust.mockClear()
}
