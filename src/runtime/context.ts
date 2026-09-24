/**
 * Estado en memoria del proceso, usado por el heartbeat y el scheduler.
 * No persiste: para persistencia ver sync/sync-state.ts y queue/repository.ts.
 */
export interface RuntimeContext {
  startedAt: number;
  sqlConnected: boolean;
  lastDbReadAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
}

export const runtime: RuntimeContext = {
  startedAt: Date.now(),
  sqlConnected: false,
  lastDbReadAt: null,
  lastSuccessfulSyncAt: null,
  lastHeartbeatAt: null,
  lastError: null,
};

export function markDbConnection(connected: boolean): void {
  runtime.sqlConnected = connected;
}

export function markDbRead(at: Date = new Date()): void {
  runtime.lastDbReadAt = at.toISOString();
}

export function markSyncSuccess(at: Date = new Date()): void {
  const iso = at.toISOString();
  runtime.lastSuccessfulSyncAt = iso;
}

export function markRuntimeError(message: string | null): void {
  runtime.lastError = message;
}

export function uptimeSeconds(): number {
  return Math.floor((Date.now() - runtime.startedAt) / 1000);
}
