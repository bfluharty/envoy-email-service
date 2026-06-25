type LogLevel = 'info' | 'warn' | 'error';

interface LogFields {
  provider?: string;
  path?: string;
  err?: unknown;
  [key: string]: unknown;
}

function log(level: LogLevel, msg: string, fields?: LogFields): void {
  const entry: Record<string, unknown> = { level, msg, ...fields };
  if (fields?.err instanceof Error) {
    entry.err = { message: fields.err.message, stack: fields.err.stack };
  }
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, fields?: LogFields) => log('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => log('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => log('error', msg, fields),
};
