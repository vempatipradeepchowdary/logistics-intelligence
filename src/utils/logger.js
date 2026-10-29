// Minimal structured JSON logger (one JSON object per line) with level filtering.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function currentLevel() {
  const configured = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  return LEVELS[configured] ?? LEVELS.info;
}

function serializeError(err) {
  if (!(err instanceof Error)) return err;
  return {
    name: err.name,
    message: err.message,
    ...(process.env.NODE_ENV !== 'production' ? { stack: err.stack } : {}),
  };
}

function write(level, msg, fields = {}) {
  if (LEVELS[level] < currentLevel()) return;
  const entry = { time: new Date().toISOString(), level, msg, pid: process.pid };
  for (const [key, value] of Object.entries(fields)) {
    entry[key] = value instanceof Error ? serializeError(value) : value;
  }
  const line = JSON.stringify(entry);
  if (LEVELS[level] >= LEVELS.warn) process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
