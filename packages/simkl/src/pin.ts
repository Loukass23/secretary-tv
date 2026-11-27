import type { SimklClient } from "./client.ts";

/** What the TV shows while the viewer signs in on their phone. */
export interface PinCode {
  userCode: string;
  /** The page to open, for example simkl.com/pin. */
  url: string;
  /** Epoch ms when the code stops working. */
  expires: number;
  /** Seconds between checks. */
  interval: number;
}

interface PinAnswer {
  result?: string;
  user_code?: string;
  verification_url?: string;
  expires_in?: number;
  interval?: number;
  access_token?: string;
  message?: string;
}

export async function startPin(c: SimklClient, now = Date.now()): Promise<PinCode> {
  const a = await c.open<PinAnswer>("/oauth/pin");
  if (!a?.user_code) throw new Error("Simkl gave no code");
  return {
    userCode: a.user_code,
    url: a.verification_url || "https://simkl.com/pin",
    expires: now + (a.expires_in ?? 900) * 1000,
    interval: Math.max(3, a.interval ?? 5),
  };
}

/** One check: "done" stores the token, "wait" means the viewer has not finished yet. */
export async function checkPin(c: SimklClient, code: PinCode, now = Date.now()): Promise<"done" | "wait" | "expired"> {
  if (now > code.expires) return "expired";
  const a = await c.open<PinAnswer>(`/oauth/pin/${encodeURIComponent(code.userCode)}`);
  if (a?.access_token) {
    c.setToken(a.access_token);
    return "done";
  }
  return "wait";
}

/**
 * Checks every `interval` seconds until the viewer signs in, the code runs out or `signal` stops it. Network
 * errors count as "not yet".
 */
export async function waitForPin(
  c: SimklClient,
  code: PinCode,
  { signal, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)), now = Date.now }: { signal?: AbortSignal; sleep?: (ms: number) => Promise<unknown>; now?: () => number } = {},
): Promise<boolean> {
  while (!signal?.aborted) {
    await sleep(code.interval * 1000);
    if (signal?.aborted) return false;
    try {
      const r = await checkPin(c, code, now());
      if (r === "done") return true;
      if (r === "expired") return false;
    } catch {
      // Try again on the next tick.
    }
  }
  return false;
}
