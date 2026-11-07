import { describe, expect, it } from 'vitest'
import { parseQuickAction } from './args'

describe('desktop quick-action args', () => {
  it('recognizes the supported flags among other argv', () => {
    expect(parseQuickAction(['electron', 'main.js', '--smart-free'])).toEqual({ kind: 'smart-free' })
    expect(parseQuickAction(['--toggle-widget'])).toEqual({ kind: 'toggle-widget' })
    expect(parseQuickAction(['--open=processes'])).toEqual({ kind: 'open', view: 'processes' })
    expect(parseQuickAction(['--disk-scan=C:\\Users\\me\\Downloads'])).toEqual({ kind: 'disk-scan', path: 'C:\\Users\\me\\Downloads' })
    expect(parseQuickAction(['--disk-scan=/home/me/Downloads'])).toEqual({ kind: 'disk-scan', path: '/home/me/Downloads' })
  })

  it('rejects unknown views, bad paths and arbitrary flags', () => {
    expect(parseQuickAction(['--open=hack'])).toBeNull()
    expect(parseQuickAction(['--open='])).toBeNull()
    expect(parseQuickAction(['--disk-scan=not-a-path'])).toBeNull()
    expect(parseQuickAction(['--disk-scan=relative/path'])).toBeNull()
    expect(parseQuickAction(['--evil', 'nothing'])).toBeNull()
    expect(parseQuickAction([])).toBeNull()
  })

  it('takes the first recognized action in order', () => {
    expect(parseQuickAction(['--open=disk', '--smart-free'])).toEqual({ kind: 'open', view: 'disk' })
  })
})
