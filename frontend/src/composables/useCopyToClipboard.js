import { ref, onBeforeUnmount } from 'vue'

// Copy-to-clipboard with a short "Copied!" state, shared by every copy
// button (asset/chart/vista gallery cards, player tracks, document headers).
// `copiedKey` holds the key of whatever was copied last, so a list can show
// the check mark on just that one row.
export function useCopyToClipboard(resetMs = 1500) {
  const copiedKey = ref(null)
  let timeout = null

  // Resolves to whether the copy worked: the Clipboard API is missing on
  // plain-HTTP origins (e.g. the app opened via a LAN IP) and can refuse
  // once the click's user activation has lapsed.
  async function copy(text, key = text) {
    if (!text) return false
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    copiedKey.value = key
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null
    }, resetMs)
    return true
  }

  onBeforeUnmount(() => clearTimeout(timeout))

  return { copiedKey, copy }
}
