import { describe, expect, it, vi } from 'vitest'
import { useLibraryPicker } from '@/composables/useLibraryPicker'

describe('useLibraryPicker', () => {
  it('gives the chosen image back with what it was chosen for, once', () => {
    const onPick = vi.fn()
    const { libraryOpen, openLibrary, onLibrarySelect } = useLibraryPicker(onPick)
    const pin = { id: 'p1' }
    openLibrary(pin)
    expect(libraryOpen.value).toBe(true)
    onLibrarySelect({ image_url: '/api/observatory/images/1a2b3c4d-icon.png' })
    expect(onPick).toHaveBeenCalledWith({ image_url: '/api/observatory/images/1a2b3c4d-icon.png' }, pin)
    expect(libraryOpen.value).toBe(false)
    onLibrarySelect({ image_url: 'late' })
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('picks nothing when closed', () => {
    const onPick = vi.fn()
    const { openLibrary, closeLibrary, onLibrarySelect, libraryOpen } = useLibraryPicker(onPick)
    openLibrary('map')
    closeLibrary()
    expect(libraryOpen.value).toBe(false)
    onLibrarySelect({ image_url: 'x' })
    expect(onPick).not.toHaveBeenCalled()
  })
})
