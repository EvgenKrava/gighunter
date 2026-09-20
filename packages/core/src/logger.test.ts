import { describe, it, expect } from 'vitest'
import { createLogger } from './logger'

describe('createLogger', () => {
  it('writes one JSON line per call with level, event and merged fields', () => {
    const lines: string[] = []
    const log = createLogger({ fn: 'poller' }, (line) => lines.push(line))
    log.info('run.start', { userId: 'u1' })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info', event: 'run.start', fn: 'poller', userId: 'u1' })
  })

  it('child() adds fields to every subsequent line', () => {
    const lines: string[] = []
    const log = createLogger({}, (line) => lines.push(line)).child({ userId: 'u2' })
    log.warn('adapter.error', { platform: 'freelancer' })
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', userId: 'u2', platform: 'freelancer' })
  })

  it('serializes Error values as message + name', () => {
    const lines: string[] = []
    const log = createLogger({}, (line) => lines.push(line))
    log.error('boom', { err: new Error('bad') })
    expect(JSON.parse(lines[0]!).err).toEqual({ name: 'Error', message: 'bad' })
  })
})
