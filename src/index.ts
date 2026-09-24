#!/usr/bin/env node
/**
 * Punto de entrada del connector NavaSoft.
 * - Sin argumentos: inicia el servicio (scheduler + heartbeat).
 * - Con argumentos: ejecuta el comando CLI correspondiente.
 */
import { runCli } from './cli/commands';

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  process.exitCode = 1;
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

runCli(process.argv).catch((err: unknown) => {
  if (!(err instanceof Error) || !err.message) {
    console.error(err);
  }
  process.exit(process.exitCode ?? 1);
});
