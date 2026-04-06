/**
 * HiveLearn — Logger simple (no depende de core)
 */

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_NUM: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const MIN_LEVEL: number = LEVEL_NUM[(process.env.HIVELEARN_LOG_LEVEL as Level) ?? 'info']

function emit(level: Level, context: string, msg: string): void {
  if (LEVEL_NUM[level] < MIN_LEVEL) return
  const ts = new Date().toISOString()
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] [${context}] ${msg}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

class ChildLogger {
  constructor(private context: string) {}
  debug(msg: string) { emit('debug', this.context, msg) }
  info(msg: string)  { emit('info',  this.context, msg) }
  warn(msg: string)  { emit('warn',  this.context, msg) }
  error(msg: string) { emit('error', this.context, msg) }
  child(sub: string) { return new ChildLogger(`${this.context}:${sub}`) }
}

class RootLogger {
  debug(msg: string) { emit('debug', 'hivelearn', msg) }
  info(msg: string)  { emit('info',  'hivelearn', msg) }
  warn(msg: string)  { emit('warn',  'hivelearn', msg) }
  error(msg: string) { emit('error', 'hivelearn', msg) }
  child(context: string) { return new ChildLogger(context) }
}

export const logger = new RootLogger()
