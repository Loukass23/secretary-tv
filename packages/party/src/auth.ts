// Who is calling: a Nuvio Cloud access token, checked against Nuvio's published signing keys, and the profile slot
// checked with the caller's own token. Web Crypto only, so it runs the same in Workers and in node:test.

export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export interface Claims {
  sub: string;
  exp: number;
  iss?: string;
  aud?: string | string[];
  role?: string;
  is_anonymous?: boolean;
  [k: string]: unknown;
}

type Alg = "ES256" | "RS256";

export interface VerifierOptions {
  /** `<nuvio url>/auth/v1/.well-known/jwks.json` */
  jwksUrl: string;
  /** `<nuvio url>/auth/v1` */
  issuer: string;
  audience?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long fetched keys are trusted before a refresh. */
  ttlMs?: number;
  /** An unknown key id refetches the set at most this often, so junk tokens cannot hammer Nuvio. */
  refetchGapMs?: number;
  leewaySec?: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const parseSegment = <T>(seg: string): T => JSON.parse(dec.decode(b64urlToBytes(seg))) as T;

const params = (alg: Alg) =>
  alg === "ES256"
    ? { imp: { name: "ECDSA", namedCurve: "P-256" }, ver: { name: "ECDSA", hash: "SHA-256" } }
    : { imp: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, ver: { name: "RSASSA-PKCS1-v1_5" } };

const algOf = (jwk: JsonWebKey): Alg | null =>
  jwk.kty === "EC" && jwk.crv === "P-256" ? "ES256" : jwk.kty === "RSA" ? "RS256" : null;

/** Returns `verify(token)`, which resolves to the token's claims or throws AuthError. Keys are cached per verifier. */
export function createJwtVerifier(opts: VerifierOptions) {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? 10 * 60_000;
  const gap = opts.refetchGapMs ?? 30_000;
  const leeway = opts.leewaySec ?? 30;
  const audience = opts.audience ?? "authenticated";
  let keys = new Map<string, { alg: Alg; key: CryptoKey }>();
  let fetchedAt = -Infinity;
  let loading: Promise<void> | null = null;

  const load = () =>
    (loading ??= (async () => {
      try {
        const res = await doFetch(opts.jwksUrl);
        if (!res.ok) throw new AuthError(`signing keys unavailable (${res.status})`, 503);
        const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
        const next = new Map<string, { alg: Alg; key: CryptoKey }>();
        for (const jwk of body.keys ?? []) {
          const alg = algOf(jwk);
          if (!alg || !jwk.kid || (jwk.alg && jwk.alg !== alg)) continue;
          const key = await crypto.subtle.importKey("jwk", jwk, params(alg).imp, false, ["verify"]);
          next.set(jwk.kid, { alg, key });
        }
        keys = next;
        fetchedAt = now();
      } finally {
        loading = null;
      }
    })());

  async function keyFor(kid: string) {
    const age = now() - fetchedAt;
    if (age >= ttl || (!keys.has(kid) && age >= gap)) await load();
    return keys.get(kid);
  }

  return async function verify(token: string): Promise<Claims> {
    const parts = token.split(".");
    if (parts.length !== 3) throw new AuthError("malformed token");
    let header: { alg?: string; kid?: string };
    let claims: Claims;
    try {
      header = parseSegment(parts[0]);
      claims = parseSegment(parts[1]);
    } catch {
      throw new AuthError("malformed token");
    }
    if (header.alg !== "ES256" && header.alg !== "RS256") throw new AuthError("unsupported algorithm");
    const entry = header.kid ? await keyFor(header.kid) : undefined;
    if (!entry || entry.alg !== header.alg) throw new AuthError("unknown signing key");
    const ok = await crypto.subtle.verify(
      params(entry.alg).ver,
      entry.key,
      b64urlToBytes(parts[2]),
      enc.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) throw new AuthError("bad signature");

    const t = now() / 1000;
    if (typeof claims.exp !== "number" || claims.exp < t - leeway) throw new AuthError("token expired");
    if (typeof claims.nbf === "number" && claims.nbf > t + leeway) throw new AuthError("token not yet valid");
    if (claims.iss !== opts.issuer) throw new AuthError("wrong issuer");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(audience)) throw new AuthError("wrong audience");
    if (typeof claims.sub !== "string" || !claims.sub) throw new AuthError("no subject");
    // The TV's QR sign-in runs under an anonymous session first; that must not open rooms.
    if (claims.is_anonymous === true || claims.role === "anon") throw new AuthError("anonymous session", 403);
    return claims;
  };
}

export interface ProfileInfo {
  index: number;
  name: string;
  color: string;
}

/**
 * The caller's profile in that slot, read with the caller's own token, so a token can only speak for its own
 * account's profiles. Null when the account has no such slot.
 */
export async function fetchProfile(input: {
  url: string;
  key: string;
  token: string;
  index: number;
  fetch?: typeof fetch;
}): Promise<ProfileInfo | null> {
  const res = await (input.fetch ?? fetch)(`${input.url}/rest/v1/rpc/sync_pull_profiles`, {
    method: "POST",
    headers: { apikey: input.key, Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401 || res.status === 403) throw new AuthError("profile check refused");
  if (!res.ok) throw new AuthError(`profile check failed (${res.status})`, 502);
  const rows = ((await res.json()) ?? []) as { profile_index?: number; name?: string; avatar_color_hex?: string | null }[];
  const row = Array.isArray(rows) ? rows.find((r) => Number(r.profile_index) === input.index) : undefined;
  // A brand-new account has no rows yet; Nuvio clients show it as a single first profile.
  if (!row) return input.index === 1 && Array.isArray(rows) && rows.length === 0 ? { index: 1, name: "Main", color: "#1E88E5" } : null;
  return {
    index: input.index,
    name: (row.name ?? "").trim().slice(0, 40) || `Profile ${input.index}`,
    color: /^#[0-9a-fA-F]{6}$/.test(row.avatar_color_hex ?? "") ? row.avatar_color_hex! : "#1E88E5",
  };
}
