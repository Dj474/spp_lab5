import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

const C = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const prefix = `${C[level]}${level.toUpperCase().padEnd(5)}${C.reset} ${C.dim}${ts}${C.reset}`;
  const line = `${prefix} ${message}`;
  const out = level === 'error' ? console.error : console.log;
  if (meta !== undefined) out(line, meta);
  else out(line);
}

export const logger = {
  debug: (m, x) => emit('debug', m, x),
  info: (m, x) => emit('info', m, x),
  warn: (m, x) => emit('warn', m, x),
  error: (m, x) => emit('error', m, x),
  child: (bindings) => ({
    debug: (m, x) => emit('debug', `[${bindings}] ${m}`, x),
    info: (m, x) => emit('info', `[${bindings}] ${m}`, x),
    warn: (m, x) => emit('warn', `[${bindings}] ${m}`, x),
    error: (m, x) => emit('error', `[${bindings}] ${m}`, x),
  }),
};
