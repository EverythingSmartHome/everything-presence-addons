import pino from 'pino';
import { LogBuffer, SERVER_LOG_BUFFER_LIMITS } from './debug/logBuffer';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Serializers applied to every log call. Many call sites log errors as
 * `{ error }`; without a serializer pino 8 renders an Error under that key as
 * `{}`, losing its message and stack.
 */
export const logSerializers = {
  err: pino.stdSerializers.err,
  error: pino.stdSerializers.err,
};

/** Base level configured at startup (LOG_LEVEL, default info). */
export const baseLogLevel: pino.LevelWithSilent = (process.env.LOG_LEVEL as pino.LevelWithSilent | undefined) ?? 'info';

/** Server-side debug buffer; only stores entries while a debug session records. */
export const serverLogBuffer = new LogBuffer(SERVER_LOG_BUFFER_LIMITS);

export interface BuildLoggerOptions {
  baseLevel: pino.LevelWithSilent;
  stdout: pino.DestinationStream;
  buffer: pino.DestinationStream;
}

/**
 * Build a logger writing to stdout at the base level and to the debug buffer
 * at any level the logger emits. Raising `logger.level` at runtime sends more
 * detail to the buffer while stdout stays at the base level.
 */
export const buildLogger = ({ baseLevel, stdout, buffer }: BuildLoggerOptions): pino.Logger =>
  pino(
    {
      name: 'zone-configurator-backend',
      level: baseLevel,
      serializers: logSerializers,
    },
    pino.multistream([
      { level: baseLevel === 'silent' ? 'fatal' : baseLevel, stream: stdout },
      { level: 'trace', stream: buffer },
    ]),
  );

const createStdoutStream = (): pino.DestinationStream => {
  if (!isProduction) {
    try {
      // pino-pretty is a dev dependency; it is absent from production images.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pretty = require('pino-pretty') as (opts: Record<string, unknown>) => pino.DestinationStream;
      return pretty({ colorize: true, translateTime: 'SYS:standard' });
    } catch {
      // Fall back to plain JSON on stdout.
    }
  }
  return pino.destination(1);
};

export const logger = buildLogger({
  baseLevel: baseLogLevel,
  stdout: createStdoutStream(),
  buffer: serverLogBuffer,
});

const LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

/** The more verbose of the base level and `debug`. */
export const debugLevelFor = (base: string): string =>
  LEVEL_ORDER.indexOf(base) >= 0 && LEVEL_ORDER.indexOf(base) <= LEVEL_ORDER.indexOf('debug') ? base : 'debug';

/**
 * Keeps the root logger and loggers derived from it (pino child loggers do
 * not follow later level changes on their parent, e.g. pino-http's internal
 * child used for `req.log`) at the same level.
 */
export class LogLevelController {
  private readonly followers = new Set<{ level: string }>();

  constructor(private readonly root: { level: string }, private readonly base: string) {}

  register(follower: { level: string }): void {
    this.followers.add(follower);
    follower.level = this.root.level;
  }

  setDebug(active: boolean): void {
    const level = active ? debugLevelFor(this.base) : this.base;
    this.root.level = level;
    for (const follower of this.followers) {
      follower.level = level;
    }
  }

  get level(): string {
    return this.root.level;
  }
}

export const logLevelController = new LogLevelController(logger, baseLogLevel);
