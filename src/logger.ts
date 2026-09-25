import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  createWriteStream,
  type WriteStream,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { Writable } from 'node:stream';
import pino, { type Level, type Logger, type LoggerOptions } from 'pino';
import { APP_VERSION } from './config/constants';
import { getEnv } from './config/env';

/**
 * Stream de archivo con rotacion simple por tamano.
 * Conserva `maxFiles` archivos rotados (archivo.1, archivo.2, ...).
 */
class RotatingFileStream extends Writable {
  private stream: WriteStream | null = null;
  private size = 0;

  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
  ) {
    super();
    mkdirSync(dirname(filePath), { recursive: true });
    this.open();
  }

  private open(): void {
    this.size = existsSync(this.filePath) ? statSync(this.filePath).size : 0;
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
    this.stream.on('error', () => {
      /* no romper el proceso por un error de log */
    });
  }

  private rotate(): void {
    const base = this.filePath;
    try {
      this.stream?.end();
    } catch {
      /* ignore */
    }
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      const src = `${base}.${i}`;
      const dst = `${base}.${i + 1}`;
      if (!existsSync(src)) continue;
      if (existsSync(dst)) {
        try {
          rmSync(dst, { force: true });
        } catch {
          /* ignore */
        }
      }
      try {
        renameSync(src, dst);
      } catch {
        /* ignore */
      }
    }
    if (existsSync(base)) {
      const dst = `${base}.1`;
      if (existsSync(dst)) {
        try {
          rmSync(dst, { force: true });
        } catch {
          /* ignore */
        }
      }
      try {
        renameSync(base, dst);
      } catch {
        /* ignore */
      }
    }
    this.open();
  }

  override _write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
    if (this.size + chunk.length > this.maxBytes) this.rotate();
    this.size += chunk.length;
    this.stream?.write(chunk, cb);
    if (!this.stream) cb();
  }

  override _final(cb: (error?: Error | null) => void): void {
    this.stream?.end(cb);
  }
}

function buildPrettyStream(): Writable | null {
  try {
    // pino-pretty es solo para desarrollo / consola interactiva.
    const requireFn = createRequire(__filename);
    const pretty = requireFn('pino-pretty');
    return pretty({
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
    }) as Writable;
  } catch {
    return null;
  }
}

function buildLogger(): Logger {
  const env = getEnv();
  const isDev = env.NODE_ENV === 'development';
  // pino acepta 'silent' en runtime aunque su tipo Level no lo incluya.
  const level = env.LOG_LEVEL as unknown as Level;

  const options: LoggerOptions = {
    level,
    base: { app: 'navasoft-connector', version: APP_VERSION, connectorId: env.CONNECTOR_ID },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        '*.password',
        'DB_PASSWORD',
        'SQL_PASSWORD',
        'REMOTE_API_KEY',
        'BKM_API_TOKEN',
        'CONNECTOR_API_TOKEN',
        'apiKey',
        '*.apiKey',
        'apiToken',
        '*.apiToken',
        'authorization',
        'headers.authorization',
      ],
      censor: '[redacted]',
    },
  };

  const streams: pino.StreamEntry[] = [];
  if (isDev) {
    const pretty = buildPrettyStream();
    streams.push({ level, stream: pretty ?? process.stdout });
  } else {
    streams.push({ level, stream: process.stdout });
  }

  if (env.LOG_FILE) {
    streams.push({
      level,
      stream: new RotatingFileStream(env.LOG_FILE, env.LOG_MAX_SIZE_BYTES, env.LOG_MAX_FILES),
    });
  }

  return streams.length > 1
    ? pino(options, pino.multistream(streams))
    : pino(options, streams[0]?.stream);
}

let rootLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!rootLogger) rootLogger = buildLogger();
  return rootLogger;
}

/** Para tests / reconfiguracion. */
export function __setLoggerForTests(logger: Logger | null): void {
  rootLogger = logger;
}

export type { Logger };
