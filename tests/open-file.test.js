import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { openFile } from '../lib/open-file'

describe('openFile', () => {
  let popup
  beforeEach(() => {
    popup = { closed: false, close: jest.fn(), location: { href: '' } }
    global.window = { open: jest.fn(() => popup), location: { href: 'https://app/page' } }
  })

  it('opens the window before the URL resolves, then points it at the URL', async () => {
    let resolve
    const p = openFile(() => new Promise(r => { resolve = r }))
    expect(window.open).toHaveBeenCalledWith('', '_blank')
    resolve('https://files/doc.pdf')
    await p
    expect(popup.location.href).toBe('https://files/doc.pdf')
    expect(window.location.href).toBe('https://app/page')
  })

  it('falls back to the current tab when the window was blocked', async () => {
    window.open = jest.fn(() => null)
    await openFile(async () => 'https://files/doc.pdf')
    expect(window.location.href).toBe('https://files/doc.pdf')
  })

  it('closes the blank window when no URL comes back', async () => {
    expect(await openFile(async () => null)).toBeNull()
    expect(popup.close).toHaveBeenCalled()
  })

  it('closes the blank window when fetching the URL throws', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(await openFile(async () => { throw new Error('nope') })).toBeNull()
    expect(popup.close).toHaveBeenCalled()
    expect(window.location.href).toBe('https://app/page')
  })
})
