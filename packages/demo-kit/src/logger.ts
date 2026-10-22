export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `bindings` to every line. */
  child(bindings: LogFields): Logger;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  readonly level?: LogLevel | undefined;
  /** Where lines go. Defaults to stdout (JSON lines). */
  readonly sink?: ((line: string) => void) | undefined;
  readonly bindings?: LogFields | undefined;
  readonly clock?: (() => Date) | undefined;
}

/**
 * Structured JSON-lines logger. One object per line, ready for journald, Loki or
 * CloudWatch. Errors are expanded into `{ name, message, code, status, stack }`.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LEVELS[options.level ?? 'info'];
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const clock = options.clock ?? (() => new Date());

  const build = (bindings: LogFields): Logger => {
    const write = (level: LogLevel, message: string, fields?: LogFields): void => {
      if (LEVELS[level] < threshold) {
        return;
      }
      const entry: Record<string, unknown> = { ts: clock().toISOString(), level, msg: message, ...bindings };
      for (const [key, value] of Object.entries(fields ?? {})) {
        entry[key] = value instanceof Error ? serializeError(value) : value;
      }
      sink(safeStringify(entry));
    };
    return {
      debug: (message, fields) => {
        write('debug', message, fields);
      },
      info: (message, fields) => {
        write('info', message, fields);
      },
      warn: (message, fields) => {
        write('warn', message, fields);
      },
      error: (message, fields) => {
        write('error', message, fields);
      },
      child: (more) => build({ ...bindings, ...more }),
    };
  };

  return build(options.bindings ?? {});
}

/** Discards everything; the default in tests. */
export const silentLogger: Logger = createLogger({ sink: () => undefined });

/**
 * Keeps a phone number recognisable in logs without storing it: `+91******3210`.
 * Business-scoped ids (`IN.123…`) are masked the same way.
 */
export function maskPhone(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (value.length <= 7) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`;
}

function serializeError(error: Error): Record<string, unknown> {
  const extra = error as Error & { code?: unknown; status?: unknown; requestId?: unknown };
  return {
    name: error.name,
    message: error.message,
    ...(extra.code === undefined ? {} : { code: extra.code }),
    ...(extra.status === undefined ? {} : { status: extra.status }),
    ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
    stack: error.stack?.split('\n').slice(0, 6).join('\n'),
  };
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, current: unknown) => {
    if (typeof current === 'bigint') {
      return current.toString();
    }
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) {
        return '[Circular]';
      }
      seen.add(current);
    }
    return current;
  });
}
