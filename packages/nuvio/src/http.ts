import type { NuvioConfig } from "./config.ts";
import { type KV, type Session, createSessionStore, toSession } from "./session.ts";

/** Renew this long before the access token runs out. */
const EARLY_MS = 30_000;

export class NuvioError extends Error {
  readonly status: number;
  /** PostgREST or GoTrue error code, when the body has one. */
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Refresh failures that mean the session is gone; anything else (5xx, offline) keeps it. */
const deadSession = (status: number, text: string) =>
  (status >= 400 && status < 500 && status !== 408 && status !== 429) ||
  /invalid.?refresh|invalid_grant|session_not_found|refresh_token_not_found/i.test(text);

async function fail(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => "");
  let code: string | undefined;
  let message = text;
  try {
    const body = JSON.parse(text) as { code?: string; error_code?: string; message?: string; msg?: string };
    code = body.code ?? body.error_code;
    message = body.message ?? body.msg ?? text;
  } catch {
    // Not JSON: keep the text.
  }
  throw new NuvioError(res.status, `${what} ${res.status}${message ? `: ${message}` : ""}`, code);
}

async function body<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * The Nuvio Cloud HTTP client: auth/v1, rest/v1 (RPCs and table reads) and functions/v1, with the session
 * renewed once at a time before it expires and one retry after a 401.
 */
export function createClient({
  config,
  kv,
  fetch: f = fetch,
  now = Date.now,
}: {
  config: NuvioConfig;
  kv: KV;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const store = createSessionStore(kv);
  let refreshing: Promise<Session | null> | null = null;

  const headers = (bearer: string | null, json: boolean): Record<string, string> => ({
    apikey: config.key,
    // Without a session the official TV clients send the publishable key as the bearer too.
    authorization: `Bearer ${bearer ?? config.key}`,
    ...(json ? { "content-type": "application/json" } : {}),
  });

  function refresh(): Promise<Session | null> {
    if (refreshing) return refreshing;
    const current = store.get();
    if (!current) return Promise.resolve(null);
    refreshing = (async () => {
      try {
        const res = await f(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: headers(null, true),
          body: JSON.stringify({ refresh_token: current.refresh }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          if (deadSession(res.status, text)) store.set(null);
          return store.get();
        }
        const next = toSession(await res.json(), now(), current.anonymous);
        if (next) store.set({ ...next, userId: next.userId || current.userId });
        return store.get();
      } catch {
        // Offline: keep the session and try again on the next call.
        return store.get();
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** A usable access token, renewed first when it is about to expire; null when signed out. */
  async function token(): Promise<string | null> {
    const s = store.get();
    if (!s) return null;
    if (s.exp - EARLY_MS > now()) return s.access;
    return (await refresh())?.access ?? null;
  }

  async function authed(url: string, init: RequestInit, what: string): Promise<Response> {
    const first = await token();
    const send = (bearer: string | null) =>
      f(url, { ...init, headers: { ...headers(bearer, init.body !== undefined), ...(init.headers as object) } });
    let res = await send(first);
    if (res.status === 401 && first) {
      const renewed = (await refresh())?.access;
      if (renewed && renewed !== first) res = await send(renewed);
    }
    if (!res.ok) await fail(res, what);
    return res;
  }

  return {
    config,
    session: store,

    /** POST /rest/v1/rpc/<name>. */
    async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
      const res = await authed(
        `${config.url}/rest/v1/rpc/${name}`,
        { method: "POST", body: JSON.stringify(args ?? {}) },
        `rpc ${name}`,
      );
      return body<T>(res);
    },

    /** GET /rest/v1/<table>?<PostgREST query>. */
    async table<T>(pathAndQuery: string): Promise<T> {
      const res = await authed(`${config.url}/rest/v1/${pathAndQuery}`, { method: "GET" }, `table ${pathAndQuery.split("?")[0]}`);
      return body<T>(res);
    },

    /** POST /functions/v1/<name>. */
    async fn<T>(name: string, args: Record<string, unknown>): Promise<T> {
      const res = await authed(
        `${config.url}/functions/v1/${name}`,
        { method: "POST", body: JSON.stringify(args) },
        `function ${name}`,
      );
      return body<T>(res);
    },

    /** POST /auth/v1/<path> with the publishable key only (sign-up, sign-in). */
    async auth<T>(path: string, args: Record<string, unknown>): Promise<T> {
      const res = await f(`${config.url}/auth/v1/${path}`, {
        method: "POST",
        headers: headers(null, true),
        body: JSON.stringify(args),
      });
      if (!res.ok) await fail(res, `auth ${path.split("?")[0]}`);
      return body<T>(res);
    },

    token,
    refresh,
    now,
    fetch: f,
  };
}

export type NuvioClient = ReturnType<typeof createClient>;
