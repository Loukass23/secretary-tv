// SmartThings OAuth for an API Access ("OAuth-In") app (docs/smartthings.md). Access tokens last 24 h; a refresh needs
// the client secret, and each refresh token works once, so every refresh is saved before its token is used. A refresh
// token unused for 29 days expires, and then the setup script has to authorize again.

export const ST_API = "https://api.smartthings.com/v1";
/**
 * The consent page. Not under /v1: that path answered "Resource representation is only available with these types"
 * once signed in, while SmartThings' own login sends you back to this one.
 */
export const ST_AUTHORIZE = "https://api.smartthings.com/oauth/authorize";

/** What the TV (or the server) needs to call SmartThings. */
export const ST_SCOPES = [
  "r:devices:*",
  "x:devices:*",
  "r:scenes:*",
  "x:scenes:*",
  "r:locations:*",
] as const;

export interface StTokens {
  access: string;
  refresh: string;
  /** Epoch ms when the access token expires. */
  exp: number;
}

export interface StClient {
  clientId: string;
  clientSecret: string;
}

/** Where tokens live: Nest's localStorage, or the server's state file. */
export interface TokenStore {
  load(): StTokens | null;
  save(tokens: StTokens): void;
}

/** Refresh this long before the access token runs out, so a request never meets an expired one. */
const EARLY_MS = 60 * 60_000;

export class StAuthError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The consent link. `codeChallenge` is PKCE's S256 challenge: SmartThings' consent page asks for S256 although the
 * docs don't mention PKCE, so the setup script sends one (and its verifier with the code). The method is left out:
 * the consent page adds `code_challenge_method=S256` itself, and sending it too was refused as
 * `invalid_code_challenge_method_provided`.
 */
export function authorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge?: string,
  scopes: readonly string[] = ST_SCOPES,
): string {
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: scopes.join(" "), state });
  if (codeChallenge) q.set("code_challenge", codeChallenge);
  return `${ST_AUTHORIZE}?${q}`;
}

async function tokenCall(client: StClient, form: Record<string, string>, f: typeof fetch, now: () => number): Promise<StTokens> {
  const res = await f(`${ST_API}/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ ...form, client_id: client.clientId }).toString(),
  });
  if (!res.ok) throw new StAuthError(res.status, `SmartThings token: ${res.status}`);
  const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!j.access_token || !j.refresh_token) throw new StAuthError(502, "SmartThings token: incomplete answer");
  return { access: j.access_token, refresh: j.refresh_token, exp: now() + (j.expires_in ?? 86_400) * 1000 };
}

/** Turns the code from the consent page's redirect into the first token pair. */
export const exchangeCode = (
  client: StClient,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
  f: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<StTokens> =>
  tokenCall(
    client,
    { grant_type: "authorization_code", code, redirect_uri: redirectUri, ...(codeVerifier ? { code_verifier: codeVerifier } : {}) },
    f,
    now,
  );

export const refreshTokens = (
  client: StClient,
  refresh: string,
  f: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<StTokens> => tokenCall(client, { grant_type: "refresh_token", refresh_token: refresh }, f, now);

/** Hands out a valid access token; `force` refreshes now (after a 401). Null when there is nothing to use. */
export type TokenSource = (force?: boolean) => Promise<string | null>;

/** A fixed token: a personal access token (about 24 h since 2025), for trying things out. */
export const staticToken = (token: string): TokenSource => async () => token || null;

/**
 * Refreshes through `store`, one refresh at a time: two callers at once would spend the same single-use refresh token.
 */
export function oauthTokens(client: StClient, store: TokenStore, f: typeof fetch = fetch, now: () => number = Date.now): TokenSource {
  let inflight: Promise<StTokens> | null = null;
  return async (force = false) => {
    const t = store.load();
    if (!t) return null;
    if (!force && t.exp - now() > EARLY_MS) return t.access;
    if (!inflight) {
      inflight = refreshTokens(client, t.refresh, f, now)
        .then((next) => {
          store.save(next);
          return next;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      return (await inflight).access;
    } catch (e) {
      // An early refresh that failed (offline, say) leaves the current token good for a while yet.
      if (!force && t.exp > now()) return t.access;
      throw e;
    }
  };
}
