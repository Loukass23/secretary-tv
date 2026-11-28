/** Synchronous key-value storage (localStorage on the TV, a Map in tests). */
export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export const SIMKL_API = "https://api.simkl.com";
const TOKEN = "sectv.simkl.token";
/** Renew this long before an OAuth 2.0 token runs out. */
const EARLY_MS = 60_000;

export class SimklError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** What is stored: a bare string from the older PIN apps (no expiry), or an OAuth 2.0 token with its refresh. */
export interface SimklToken {
  access: string;
  refresh?: string;
  /** Epoch ms when `access` stops working; absent when it does not expire. */
  exp?: number;
}

export interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

export function toToken(a: TokenAnswer, now = Date.now()): SimklToken | null {
  if (!a?.access_token) return null;
  return { access: a.access_token, refresh: a.refresh_token, exp: a.expires_in ? now + a.expires_in * 1000 : undefined };
}

export interface SimklClient {
  readonly clientId: string;
  /** Set for OAuth 2.0 apps: the token exchange authenticates with it. */
  readonly clientSecret: string;
  /** Signed in: a token is stored. A 401, or a refresh Simkl refuses, clears it. */
  signedIn(): boolean;
  setToken(token: SimklToken | string | null): void;
  /** An authorised call; throws `SimklError` on a non-2xx answer. */
  call<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T>;
  /** A call without the token that never throws on the status (the sign-in, whose "not yet" is a 400). */
  raw<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<{ status: number; body: T }>;
}

export function createSimkl({
  clientId,
  clientSecret = "",
  kv,
  fetch: f = fetch,
  now = Date.now,
}: {
  clientId: string;
  clientSecret?: string;
  kv: KV;
  fetch?: typeof fetch;
  now?: () => number;
}): SimklClient {
  const read = (): SimklToken | null => {
    const t = kv.get<SimklToken | string>(TOKEN);
    if (typeof t === "string") return t ? { access: t } : null;
    return t && typeof t.access === "string" ? t : null;
  };
  let refreshing: Promise<SimklToken | null> | null = null;

  async function raw<T>(path: string, init: { method?: string; body?: unknown } = {}, bearer?: string): Promise<{ status: number; body: T }> {
    const sep = path.includes("?") ? "&" : "?";
    const headers: Record<string, string> = { "Content-Type": "application/json", "simkl-api-key": clientId };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await f(`${SIMKL_API}${path}${sep}client_id=${encodeURIComponent(clientId)}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }
    return { status: res.status, body: body as T };
  }

  /** The token to send, renewed first when it is about to run out. */
  async function fresh(): Promise<SimklToken | null> {
    const t = read();
    if (!t || !t.exp || !t.refresh || t.exp - EARLY_MS > now()) return t;
    refreshing ??= (async () => {
      try {
        const r = await raw<TokenAnswer>("/oauth2/token", {
          method: "POST",
          body: { grant_type: "refresh_token", refresh_token: t.refresh, client_id: clientId, client_secret: clientSecret },
        });
        if (r.status >= 500) return t;
        const next = toToken(r.body, now());
        kv.set(TOKEN, next);
        return next;
      } catch {
        // Offline: try the old one.
        return t;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  return {
    clientId,
    clientSecret,
    signedIn: () => Boolean(clientId && read()),
    setToken: (t) => kv.set(TOKEN, typeof t === "string" ? { access: t } : t),
    raw: (path, init) => raw(path, init),
    async call<T>(path: string, init?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
      const t = await fresh();
      const r = await raw<T>(path, init, t?.access);
      if (r.status === 401 && t) kv.set(TOKEN, null);
      if (r.status < 200 || r.status >= 300) throw new SimklError(r.status, `Simkl ${path.split("?")[0]} ${r.status}`);
      return r.body;
    },
  };
}
