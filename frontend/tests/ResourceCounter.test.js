// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ResourceCounter from '@/components/ResourceCounter.vue'

const counter = (props) => mount(ResourceCounter, { props: { name: 'HP', current: 4, max: 6, ...props } })

describe('ResourceCounter', () => {
  it('draws a pip per point, filled up to the current value', () => {
    const wrapper = counter()
    expect(wrapper.findAll('.rc-pip')).toHaveLength(6)
    expect(wrapper.findAll('.rc-pip.filled')).toHaveLength(4)
  })

  it('counts its pips from its min, like its bar', () => {
    const wrapper = counter({ min: 1, max: 5, current: 3 })
    expect(wrapper.findAll('.rc-pip')).toHaveLength(4)
    expect(wrapper.findAll('.rc-pip.filled')).toHaveLength(2)
    const below = counter({ min: -3, max: 3, current: 0 })
    expect(below.findAll('.rc-pip')).toHaveLength(6)
    expect(below.findAll('.rc-pip.filled')).toHaveLength(3)
  })

  it('switches to a bar when there would be too many pips', () => {
    const wrapper = counter({ current: 25, max: 50 })
    expect(wrapper.find('.rc-pip').exists()).toBe(false)
    expect(wrapper.find('.rc-bar-fill').attributes('style')).toContain('width: 50%')
  })

  it('honours the requested display, within reason', () => {
    expect(counter({ display: 'bar' }).find('.rc-bar').exists()).toBe(true)
    expect(counter({ display: 'number' }).find('.rc-value').text()).toBe('4 / 6')
    expect(counter({ display: 'pips', max: 40, current: 10 }).find('.rc-bar').exists()).toBe(true)
  })

  it('is read only by default and shows the maximum', () => {
    const wrapper = counter()
    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.find('.rc-value').text()).toBe('6')
  })

  it('asks for a change when edited, and stops at the limits', async () => {
    const wrapper = counter({ editable: true })
    const [minus, plus] = wrapper.findAll('button')
    await minus.trigger('click')
    await plus.trigger('click')
    expect(wrapper.emitted('adjust')).toEqual([[-1], [1]])
    expect(wrapper.find('.rc-value').text()).toBe('4 / 6')

    const empty = counter({ editable: true, current: 0 })
    expect(empty.findAll('button')[0].attributes('disabled')).toBeDefined()
    const full = counter({ editable: true, current: 6 })
    expect(full.findAll('button')[1].attributes('disabled')).toBeDefined()
  })

  it('takes its colour from the sheet', () => {
    expect(counter({ color: 'crimson' }).attributes('style')).toContain('--rc-color: crimson')
  })
})
