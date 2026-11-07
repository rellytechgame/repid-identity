import { describe, expect, it } from 'vitest'
import type { AppGroup } from '../types'
import { ioByGroup, ioTotal, parseProcessIo } from './io'

describe('per-process disk I/O', () => {
  it('parses "pid|read|write" rows and skips zero, pid 0 and garbage', () => {
    const m = parseProcessIo('1234|2097152|65536\n0|9|9\n5678|0|0\n4321|12.7|8.2\nnot a row\n')
    expect([...m.entries()]).toEqual([
      [1234, { read: 2097152, write: 65536 }],
      [4321, { read: 13, write: 8 }]
    ])
  })

  it('sums rates over each group’s pids and omits idle groups', () => {
    const groups = [
      { id: 'chrome', pids: [10, 11, 12] },
      { id: 'idle', pids: [20] }
    ] as Pick<AppGroup, 'id' | 'pids'>[]
    const byPid = new Map([
      [10, { read: 1000, write: 500 }],
      [11, { read: 200, write: 0 }],
      [12, { read: 0, write: 0 }]
    ])
    const out = ioByGroup(groups, byPid)
    expect(out.get('chrome')).toEqual({ read: 1200, write: 500 })
    expect(out.has('idle')).toBe(false)
  })

  it('ioTotal adds read and write, treating missing values as zero', () => {
    expect(ioTotal({ ioRead: 1000, ioWrite: 250 })).toBe(1250)
    expect(ioTotal({})).toBe(0)
  })
})
