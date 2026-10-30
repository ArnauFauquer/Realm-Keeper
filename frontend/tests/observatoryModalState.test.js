import { describe, expect, it } from 'vitest'
import { createModalState } from '@/composables/useModalState'
import { folderOf, useObservatoryModal } from '@/composables/useObservatoryModal'

describe('createModalState', () => {
  it('opens at a target, and ignores anything that is not a string (a click event)', () => {
    const m = createModalState()
    m.open('chart-1')
    expect(m.isOpen.value).toBe(true)
    expect(m.targetId.value).toBe('chart-1')
    m.open({ type: 'click' })
    expect(m.targetId.value).toBeNull()
    m.close()
    expect(m.isOpen.value).toBe(false)
  })

  it('gives each state its own isOpen', () => {
    const a = createModalState()
    const b = createModalState()
    a.open()
    expect(b.isOpen.value).toBe(false)
  })
})

describe('useObservatoryModal', () => {
  it('opens at a folder, or on everything of one kind', () => {
    const o = useObservatoryModal()
    o.openKind('chart')
    expect(o.isOpen.value).toBe(true)
    expect(o.kind.value).toBe('chart')
    expect(o.targetId.value).toBeNull()
    o.open('act 2/caves')
    expect(o.kind.value).toBeNull()
    expect(o.targetId.value).toBe('act 2/caves')
    o.close()
    expect(o.isOpen.value).toBe(false)
  })

  it('names the folder of a document', () => {
    expect(folderOf('act 2/caves/fight')).toBe('act 2/caves')
    expect(folderOf('fight')).toBe('')
    expect(folderOf('')).toBe('')
    expect(folderOf(null)).toBe('')
  })
})
