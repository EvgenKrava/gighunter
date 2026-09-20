export type LogFields = Record<string, unknown>

export interface Logger {
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
  child(extra: LogFields): Logger
}

type Sink = (line: string) => void

function normalize(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [k, v] of Object.entries(fields)) {
    out[k] = v instanceof Error ? { name: v.name, message: v.message } : v
  }
  return out
}

export function createLogger(base: LogFields = {}, sink: Sink = (l) => process.stdout.write(l + '\n')): Logger {
  const emit = (level: 'info' | 'warn' | 'error', event: string, fields: LogFields = {}) =>
    sink(JSON.stringify({ level, event, ts: new Date().toISOString(), ...normalize(base), ...normalize(fields) }))
  return {
    info: (e, f) => emit('info', e, f),
    warn: (e, f) => emit('warn', e, f),
    error: (e, f) => emit('error', e, f),
    child: (extra) => createLogger({ ...base, ...extra }, sink),
  }
}
