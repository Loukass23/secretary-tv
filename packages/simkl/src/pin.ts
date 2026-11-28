import { type SimklClient, type TokenAnswer, toToken } from "./client.ts";

/** What the TV shows while the viewer signs in on their phone. */
export interface PinCode {
  userCode: string;
  /** The page to open, for example simkl.com/pin. */
  url: string;
  /** The page with the code already filled in, for the QR; `url` when Simkl gives none. */
  urlWithCode: string;
  /** Epoch ms when the code stops working. */
  expires: number;
  /** Seconds between checks. */
  interval: number;
  /** OAuth 2.0 apps: the device code the token exchange takes. Absent for the older PIN apps. */
  deviceCode?: string;
}

interface DeviceAnswer {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  verification_url?: string;
  expires_in?: number;
  interval?: number;
  error?: string;
}

const toCode = (a: DeviceAnswer, now: number): PinCode | null => {
  if (!a?.user_code) return null;
  const url = a.verification_uri || a.verification_url || "https://simkl.com/pin";
  return {
    userCode: a.user_code,
    url,
    urlWithCode: a.verification_uri_complete || url,
    expires: now + (a.expires_in ?? 900) * 1000,
    interval: Math.max(3, a.interval ?? 5),
    deviceCode: a.device_code,
  };
};

/**
 * A code for the phone. OAuth 2.0 apps use the device flow (`/oauth2/device`); an app made before it answers there with
 * an error and gets the older PIN (`/oauth/pin`).
 */
export async function startPin(c: SimklClient, now = Date.now()): Promise<PinCode> {
  const d = await c.raw<DeviceAnswer>("/oauth2/device", { method: "POST", body: { client_id: c.clientId } });
  const viaDevice = d.status >= 200 && d.status < 300 ? toCode(d.body, now) : null;
  if (viaDevice) return viaDevice;
  const p = await c.raw<DeviceAnswer>("/oauth/pin");
  const viaPin = p.status >= 200 && p.status < 300 ? toCode(p.body, now) : null;
  if (!viaPin) throw new Error(`Simkl gave no code (${d.status}, ${p.status})`);
  return { ...viaPin, deviceCode: undefined };
}

export type PinState = "done" | "wait" | "slower" | "expired" | "denied";

/** One check: "done" stores the token; "slower" asks for a longer wait between checks. */
export async function checkPin(c: SimklClient, code: PinCode, now = Date.now()): Promise<PinState> {
  if (now > code.expires) return "expired";
  if (code.deviceCode) {
    const r = await c.raw<TokenAnswer & { error?: string }>("/oauth2/token", {
      method: "POST",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: code.deviceCode,
        client_id: c.clientId,
        client_secret: c.clientSecret,
      },
    });
    const t = toToken(r.body, now);
    if (t) {
      c.setToken(t);
      return "done";
    }
    const e = r.body?.error;
    if (e === "slow_down") return "slower";
    if (e === "expired_token") return "expired";
    if (e === "access_denied" || e === "invalid_client") return "denied";
    return "wait";
  }
  const r = await c.raw<TokenAnswer>(`/oauth/pin/${encodeURIComponent(code.userCode)}`);
  if (r.body?.access_token) {
    c.setToken(r.body.access_token);
    return "done";
  }
  return "wait";
}

/**
 * Checks every `interval` seconds until the viewer signs in, the code runs out, Simkl refuses it or `signal` stops it.
 * Network errors count as "not yet".
 */
export async function waitForPin(
  c: SimklClient,
  code: PinCode,
  { signal, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), now = Date.now }: { signal?: AbortSignal; sleep?: (ms: number) => Promise<unknown>; now?: () => number } = {},
): Promise<boolean> {
  let every = code.interval;
  while (!signal?.aborted) {
    await sleep(every * 1000);
    if (signal?.aborted) return false;
    try {
      const r = await checkPin(c, code, now());
      if (r === "done") return true;
      if (r === "expired" || r === "denied") return false;
      if (r === "slower") every += 5;
    } catch {
      // Try again on the next tick.
    }
  }
  return false;
}
