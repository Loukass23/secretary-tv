import { TV_LOGIN_BASE } from "./config.ts";
import { createClient, type NuvioClient, NuvioError } from "./http.ts";
import { memoryKv, type Session, toSession } from "./session.ts";

// The QR sign-in uses RPCs the official Nuvio TV apps call but nuvio.tv/docs does not list
// (start_tv_login_session, poll_tv_login_session, functions/v1/tv-logins-exchange). Each one is
// called from exactly one function here so a change on Nuvio's side is a change in one place.

/** Email and password, typed on the TV keyboard. */
export async function signInPassword(c: NuvioClient, email: string, password: string): Promise<void> {
  const body = await c.auth<unknown>("token?grant_type=password", { email: email.trim(), password });
  const session = toSession(body, c.now(), false);
  if (!session) throw new NuvioError(500, "sign-in returned no session");
  c.session.set(session);
}

/** Ends the session on the server when it can, and always on the TV. */
export async function signOut(c: NuvioClient): Promise<void> {
  const token = c.session.get()?.access;
  c.session.set(null);
  if (!token) return;
  try {
    await c.fetch(`${c.config.url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: c.config.key, authorization: `Bearer ${token}` },
    });
  } catch {
    // Offline: the token runs out by itself.
  }
}

/** The anonymous session the QR RPCs run under; kept when one is already held. */
export async function ensureSession(c: NuvioClient, platform = "tizen"): Promise<void> {
  if (c.session.get()) return;
  let body: unknown;
  try {
    body = await c.auth("signup", { data: { tv_client: platform } });
  } catch {
    body = await c.auth("token?grant_type=anonymous", {});
  }
  const session = toSession(body, c.now(), true);
  if (!session) throw new NuvioError(500, "anonymous sign-up returned no session");
  c.session.set(session);
}

export interface QrLogin {
  code: string;
  nonce: string;
  /** What the QR code encodes. */
  url: string;
  /** Short code shown under the QR for typing on another device, when the server gives one. */
  userCode?: string;
  /** Epoch ms. */
  expiresAt: number;
  intervalMs: number;
}

export type QrStatus = "pending" | "approved" | "expired" | "cancelled" | "used";

type Row = Record<string, unknown>;
const firstRow = (v: unknown): Row => ((Array.isArray(v) ? v[0] : v) ?? {}) as Row;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
/** The server's poll interval, kept between 2 and 60 s; 3 s when it gives none. */
const interval = (v: unknown) => (typeof v === "number" && v > 0 ? Math.min(60, Math.max(2, v)) : 3) * 1000;
/** Ten minutes when the server gives no expiry. */
const expiry = (v: unknown, now: number) => {
  const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(t) ? t : now + 600_000;
};

const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 3) | 8).toString(16);
  });

/** Opens a TV login: the phone scans the QR, signs in on nuvio.tv and approves this TV. */
export async function startQrLogin(
  c: NuvioClient,
  { deviceName = "Secretary TV", redirectBase = TV_LOGIN_BASE }: { deviceName?: string; redirectBase?: string } = {},
): Promise<QrLogin> {
  await ensureSession(c);
  const nonce = uuid();
  const args = { p_device_nonce: nonce, p_redirect_base_url: redirectBase, p_device_name: deviceName };
  let raw: unknown;
  try {
    raw = await c.rpc("start_tv_login_session", args);
  } catch (e) {
    // Older servers do not take a device name.
    if (!(e instanceof NuvioError) || !/device_name/.test(e.message)) throw e;
    const { p_device_name: _drop, ...rest } = args;
    raw = await c.rpc("start_tv_login_session", rest);
  }
  const row = firstRow(raw);
  const code = str(row.code) ?? str(row.device_code);
  if (!code) throw new NuvioError(500, "TV login returned no code");
  return {
    code,
    nonce,
    url:
      str(row.web_url) ??
      str(row.qr_content) ??
      str(row.verification_uri_complete) ??
      `${redirectBase}?code=${encodeURIComponent(code)}`,
    userCode: str(row.user_code),
    expiresAt: expiry(row.expires_at, c.now()),
    intervalMs: interval(row.poll_interval_seconds),
  };
}

export async function pollQrLogin(c: NuvioClient, login: QrLogin): Promise<{ status: QrStatus; intervalMs: number }> {
  const row = firstRow(await c.rpc("poll_tv_login_session", { p_code: login.code, p_device_nonce: login.nonce }));
  const s = String(row.status ?? "pending").toLowerCase();
  const status: QrStatus =
    s === "pending" || s === "expired" || s === "cancelled" || s === "used" ? s : s === "canceled" ? "cancelled" : "approved";
  return { status, intervalMs: interval(row.poll_interval_seconds ?? login.intervalMs / 1000) };
}

/** Trades an approved login for the account's own session, replacing the anonymous one. */
export async function exchangeQrLogin(c: NuvioClient, login: QrLogin): Promise<void> {
  const body = await c.fn<unknown>("tv-logins-exchange", { code: login.code, device_nonce: login.nonce });
  const session = toSession(body, c.now(), false);
  if (!session) throw new NuvioError(500, "TV login exchange returned no session");
  c.session.set(session);
}

/**
 * Approves another app's TV login with this (signed-in) session, as nuvio.tv/tv-login does. Nest uses it so each
 * catalog app gets a session of its own without a second QR.
 */
export async function approveQrLogin(c: NuvioClient, code: string): Promise<void> {
  const row = firstRow(await c.rpc("approve_tv_login_session", { p_code: code }));
  if (row.success === false) throw new NuvioError(400, String(row.message ?? "TV login not approved"));
}

export type QrOutcome = "signed-in" | "expired" | "cancelled";

/**
 * Polls until the phone approves, then exchanges. Network errors and 5xx keep it waiting; it stops at the
 * login's expiry or when `signal` aborts (the user left the screen), which reports "cancelled".
 */
export async function waitForQrLogin(
  c: NuvioClient,
  login: QrLogin,
  {
    signal,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  }: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void> } = {},
): Promise<QrOutcome> {
  let wait = login.intervalMs;
  let approved = false;
  while (!signal?.aborted) {
    if (c.now() >= login.expiresAt) return "expired";
    try {
      if (!approved) {
        const poll = await pollQrLogin(c, login);
        wait = poll.intervalMs;
        if (poll.status === "expired") return "expired";
        if (poll.status === "cancelled" || poll.status === "used") return "cancelled";
        approved = poll.status === "approved";
      }
      if (approved) {
        await exchangeQrLogin(c, login);
        return "signed-in";
      }
    } catch (e) {
      // A 4xx other than rate limiting will not get better by waiting.
      if (e instanceof NuvioError && e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 408) throw e;
    }
    await sleep(wait);
  }
  return "cancelled";
}

/**
 * A new session of the signed-in account for another app on this TV: a TV login opened under a throwaway anonymous
 * session, approved by this one, then exchanged. The result never touches `c`'s storage and has its own refresh
 * token, so the two never renew each other away.
 */
export async function mintAppSession(
  c: NuvioClient,
  { deviceName = "Secretary TV", sleep }: { deviceName?: string; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Session> {
  if (!c.session.signedIn()) throw new NuvioError(401, "not signed in");
  const temp = createClient({ config: c.config, kv: memoryKv(), fetch: c.fetch, now: c.now });
  const login = await startQrLogin(temp, { deviceName });
  await approveQrLogin(c, login.code);
  const outcome = await waitForQrLogin(temp, login, { sleep });
  const session = temp.session.get();
  if (outcome !== "signed-in" || !session || session.anonymous) throw new NuvioError(500, `app sign-in ${outcome}`);
  return session;
}

/** Whether the API answers at all (no session needed). */
export async function ping(c: NuvioClient): Promise<boolean> {
  try {
    return (await c.rpc<unknown>("health_ping")) === true;
  } catch {
    return false;
  }
}
