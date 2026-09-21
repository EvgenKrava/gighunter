import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagInput } from './TagInput'
import { Field } from './Field'

describe('TagInput', () => {
  it('adds on Enter/comma, ignores duplicates, removes on ×', async () => {
    const onChange = vi.fn()
    render(<TagInput value={['react']} onChange={onChange} placeholder="add" />)
    const input = screen.getByPlaceholderText('add')
    await userEvent.type(input, 'node{enter}')
    expect(onChange).toHaveBeenLastCalledWith(['react', 'node'])
    await userEvent.type(input, 'React,')
    expect(onChange).not.toHaveBeenLastCalledWith(['react', 'react'])
    await userEvent.click(screen.getByLabelText('Remove react'))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
  it('focuses the input instead of removing a tag when the field label is clicked', async () => {
    const onChange = vi.fn()
    render(
      <Field label="Tags">
        <TagInput value={['react']} onChange={onChange} placeholder="add" />
      </Field>,
    )
    await userEvent.click(screen.getByText('Tags'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('add')).toHaveFocus()
  })
})
