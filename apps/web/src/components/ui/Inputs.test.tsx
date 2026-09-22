import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Select, TextInput } from './Inputs'

describe('Select', () => {
  // WebKit's native menulist clamps author min-height (to 18px on macOS), so a select styled only with
  // min-h-11 renders 23px tall next to a 44px text input. An explicit height is honoured everywhere.
  it('sets an explicit height so Safari renders it as tall as a text input', () => {
    render(
      <>
        <TextInput aria-label="text" />
        <Select aria-label="level"><option>solid</option></Select>
      </>,
    )
    expect(screen.getByLabelText('level')).toHaveClass('h-11')
    expect(screen.getByLabelText('text')).toHaveClass('min-h-11')
  })
})
