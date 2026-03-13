import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SearchBar from '../src/components/SearchBar.vue'

describe('SearchBar.vue', () => {
  it('renders correctly', () => {
    const wrapper = mount(SearchBar, {
      props: { modelValue: '' }
    })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('emits update:modelValue on input', async () => {
    const wrapper = mount(SearchBar, {
      props: { modelValue: '' }
    })
    
    const input = wrapper.find('input')
    await input.setValue('test search')
    
    expect(wrapper.emitted()).toHaveProperty('update:modelValue')
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['test search'])
  })
})
