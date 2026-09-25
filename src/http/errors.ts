/**
 * Errores tipados de la API HTTP local.
 * El handler de errores nunca expone stack traces ni secretos.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** Convierte cualquier error en un status + body seguro para el cliente. */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Error interno del connector' } },
  };
}
