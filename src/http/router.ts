import type { Env } from '../config/env';

export interface RequestContext {
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  authorization: string | undefined;
  clientIp: string;
  body: unknown;
  env: Env;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: RequestContext) => Promise<HttpResponse> | HttpResponse;

interface ParamRoute {
  method: string;
  segments: string[];
  handler: Handler;
}

export interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
}

/** Normaliza un pathname: barra inicial, sin barra final (excepto raiz). */
export function normalizePath(pathname: string): string {
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) return withSlash.replace(/\/+$/, '');
  return withSlash;
}

function splitPath(pathname: string): string[] {
  return normalizePath(pathname)
    .split('/')
    .filter((segment) => segment.length > 0);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Router minimo: soporta rutas exactas y un parametro por segmento (`:name`). */
export class Router {
  private readonly exact = new Map<string, Handler>();
  private readonly paramRoutes: ParamRoute[] = [];

  add(method: string, path: string, handler: Handler): this {
    const upper = method.toUpperCase();
    const normalized = normalizePath(path);
    const segments = splitPath(path);
    if (segments.some((segment) => segment.startsWith(':'))) {
      this.paramRoutes.push({ method: upper, segments, handler });
    } else {
      this.exact.set(`${upper} ${normalized}`, handler);
    }
    return this;
  }

  match(method: string, pathname: string): RouteMatch | null {
    const upper = method.toUpperCase();
    const exactHandler = this.exact.get(`${upper} ${normalizePath(pathname)}`);
    if (exactHandler) return { handler: exactHandler, params: {} };

    const segments = splitPath(pathname);
    for (const route of this.paramRoutes) {
      if (route.method !== upper || route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSegment = route.segments[i] as string;
        const actual = segments[i] as string;
        if (routeSegment.startsWith(':')) params[routeSegment.slice(1)] = safeDecode(actual);
        else if (routeSegment !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  /** Metodos registrados para un pathname (para responder 405). */
  allowedMethods(pathname: string): string[] {
    const normalized = normalizePath(pathname);
    const segments = splitPath(pathname);
    const methods = new Set<string>();

    for (const key of this.exact.keys()) {
      const [method, path] = key.split(' ');
      if (path === normalized && method) methods.add(method);
    }
    for (const route of this.paramRoutes) {
      if (route.segments.length !== segments.length) continue;
      const matched = route.segments.every(
        (routeSegment, i) =>
          routeSegment.startsWith(':') || routeSegment === (segments[i] as string),
      );
      if (matched) methods.add(route.method);
    }
    return [...methods].sort();
  }
}
