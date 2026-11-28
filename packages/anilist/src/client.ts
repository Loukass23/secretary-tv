/** Synchronous key-value storage (localStorage on the TV, a Map in tests). */
export interface KV {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export const ANILIST_GRAPHQL = "https://graphql.anilist.co";
export const ANILIST_AUTHORIZE = "https://anilist.co/api/v2/oauth/authorize";
const TOKEN = "sectv.anilist.token";

export class AniListError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AniListToken {
  access: string;
  /** Epoch ms when it stops working (AniList tokens last a year), from the token's own claims. */
  exp?: number;
}

/** The page the phone opens: AniList's sign-in, ending on its pin page that shows the token to copy. */
export const authorizeUrl = (clientId: string) => `${ANILIST_AUTHORIZE}?client_id=${encodeURIComponent(clientId)}&response_type=token`;

/** The JWT's `exp`, in ms, or undefined when the token is not one. */
export function tokenExpiry(token: string): number | undefined {
  try {
    const part = token.split(".")[1] ?? "";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const claims = JSON.parse(atob(b64)) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The token out of whatever the phone pasted: the bare token from the pin page, or a whole redirect URL with
 * `#access_token=…`. Null when it does not look like one (a JWT: three dot-separated parts).
 */
export function tokenFromText(text: string): string | null {
  const t = text.trim();
  const m = /access_token=([^&\s#]+)/.exec(t);
  const token = (m ? decodeURIComponent(m[1]) : t).replace(/\s+/g, "");
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) && token.length > 40 ? token : null;
}

export interface AniListClient {
  readonly clientId: string;
  signedIn(): boolean;
  setToken(token: string | null): void;
  /** A GraphQL call as the viewer; throws `AniListError` on HTTP or GraphQL errors. A 401 forgets the token. */
  query<T>(query: string, variables?: Record<string, unknown>, token?: string): Promise<T>;
}

export function createAniList({ clientId, kv, fetch: f = fetch, now = Date.now }: { clientId: string; kv: KV; fetch?: typeof fetch; now?: () => number }): AniListClient {
  const read = (): AniListToken | null => {
    const t = kv.get<AniListToken>(TOKEN);
    if (!t?.access) return null;
    if (t.exp && t.exp < now()) {
      kv.set(TOKEN, null);
      return null;
    }
    return t;
  };
  return {
    clientId,
    signedIn: () => Boolean(clientId && read()),
    setToken: (t) => kv.set(TOKEN, t ? { access: t, exp: tokenExpiry(t) } : null),
    async query<T>(query: string, variables: Record<string, unknown> = {}, token?: string): Promise<T> {
      const access = token ?? read()?.access;
      const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
      if (access) headers.Authorization = `Bearer ${access}`;
      const res = await f(ANILIST_GRAPHQL, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
      if (res.status === 401 && !token) kv.set(TOKEN, null);
      const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string; status?: number }[] } | null;
      const err = body?.errors?.[0];
      if (!res.ok || err || !body?.data) throw new AniListError(err?.status ?? res.status, `AniList ${err?.message ?? res.status}`);
      return body.data;
    },
  };
}
