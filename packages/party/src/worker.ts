// The Worker in front of the rooms: checks the caller's Nuvio session, creates rooms, hands out join tickets, and
// passes WebSocket upgrades to the room's Durable Object. docs/watch-party.md has the routes.
import { AuthError, createJwtVerifier, fetchProfile, type ProfileInfo } from "./auth.ts";
import { refuseSocket, type DurableObjectNamespaceLike, type RateLimiterLike } from "./cf.ts";
import { TICKET_HEADER } from "./do.ts";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  Close,
  cleanRelease,
  cleanTitle,
  isContentId,
  isRelease,
  normalizeCode,
  type Control,
} from "./protocol.ts";
import type { Identity, RoomInit, RoomSummary } from "./room.ts";
import { signTicket, TICKET_TTL_MS, verifyTicket } from "./ticket.ts";

export { PartyRoom } from "./do.ts";
export { CODE_ALPHABET, CODE_LENGTH, normalizeCode };

export interface Env {
  ROOMS: DurableObjectNamespaceLike;
  /** Nuvio Cloud, without a trailing slash. */
  NUVIO_URL: string;
  /** Nuvio's publishable key (public). */
  NUVIO_KEY: string;
  /** HMAC secret for join tickets (`wrangler secret put TICKET_SECRET`). */
  TICKET_SECRET: string;
  /** Public origin of this Worker, for join links; defaults to the request's own. */
  PUBLIC_URL?: string;
  /** Optional rate limiting binding for room creation, keyed by account. */
  CREATE_LIMIT?: RateLimiterLike;
}

export interface Deps {
  fetch: typeof fetch;
  now: () => number;
}

export function newCode(): string {
  let out = "";
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2))) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % n];
    }
  }
  return out;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export function createHandler(deps: Deps) {
  // Lives as long as the isolate, so the signing keys are fetched once per isolate, not per request.
  const verifiers = new Map<string, ReturnType<typeof createJwtVerifier>>();
  const verifierFor = (env: Env) => {
    const key = env.NUVIO_URL;
    let v = verifiers.get(key);
    if (!v) {
      v = createJwtVerifier({
        jwksUrl: `${env.NUVIO_URL}/auth/v1/.well-known/jwks.json`,
        issuer: `${env.NUVIO_URL}/auth/v1`,
        fetch: deps.fetch,
        now: deps.now,
      });
      verifiers.set(key, v);
    }
    return v;
  };

  /** The caller as a room member: a verified token plus a profile slot the account really has. */
  async function caller(req: Request, env: Env, profileIndex: unknown): Promise<{ sub: string; who: Identity }> {
    const token = /^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "")?.[1];
    if (!token) throw new AuthError("sign in first");
    const claims = await verifierFor(env)(token);
    const index = Number(profileIndex);
    if (!Number.isInteger(index) || index < 1 || index > 6) throw new AuthError("bad profile", 400);
    const p: ProfileInfo | null = await fetchProfile({
      url: env.NUVIO_URL,
      key: env.NUVIO_KEY,
      token,
      index,
      fetch: deps.fetch,
    });
    if (!p) throw new AuthError("no such profile", 403);
    return { sub: claims.sub, who: { id: `${claims.sub}:${p.index}`, name: p.name, color: p.color } };
  }

  const stubFor = (env: Env, code: string) => env.ROOMS.get(env.ROOMS.idFromName(code));

  async function summaryOf(env: Env, code: string): Promise<RoomSummary | null> {
    const res = await stubFor(env, code).fetch("https://room/summary");
    return res.ok ? ((await res.json()) as RoomSummary) : null;
  }

  async function joinBundle(req: Request, env: Env, code: string, who: Identity) {
    const origin = (env.PUBLIC_URL || new URL(req.url).origin).replace(/\/+$/, "");
    const exp = deps.now() + TICKET_TTL_MS;
    const ticket = await signTicket(env.TICKET_SECRET, { room: code, member: who, exp });
    return {
      code,
      joinUrl: `${origin}/j/${code}`,
      wsUrl: `${origin.replace(/^http/, "ws")}/rooms/${code}/ws?ticket=${encodeURIComponent(ticket)}`,
      ticketExpiresAt: exp,
    };
  }

  async function createRoom(req: Request, env: Env): Promise<Response> {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json(400, { error: "expected JSON" });
    const { sub, who } = await caller(req, env, body.profile);
    if (!isContentId(body.contentId)) return json(400, { error: "contentId" });
    if (!isRelease(body.release)) return json(400, { error: "release must be {infoHash, fileIdx, size}" });
    const control: Control = body.control === "shared" ? "shared" : "host";
    if (env.CREATE_LIMIT && !(await env.CREATE_LIMIT.limit({ key: sub })).success) {
      return json(429, { error: "too many rooms" });
    }
    const startPos = typeof body.startPos === "number" && body.startPos > 0 ? body.startPos : 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newCode();
      const init: RoomInit = {
        code,
        control,
        host: who,
        contentId: body.contentId,
        title: cleanTitle(body.title),
        release: cleanRelease(body.release),
        startPos,
      };
      const res = await stubFor(env, code).fetch("https://room/create", {
        method: "POST",
        body: JSON.stringify(init),
      });
      if (res.status === 409) continue;
      if (!res.ok) return json(502, { error: "room service" });
      return json(201, { ...(await joinBundle(req, env, code, who)), room: await res.json() });
    }
    return json(503, { error: "no free code" });
  }

  async function ticketFor(req: Request, env: Env, code: string): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { who } = await caller(req, env, body.profile);
    const summary = await summaryOf(env, code);
    if (!summary) return json(404, { error: "no such room" });
    if (summary.full) return json(409, { error: "room is full" });
    return json(200, { ...(await joinBundle(req, env, code, who)), room: summary });
  }

  async function socket(req: Request, env: Env, code: string): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json(426, { error: "expected a WebSocket" });
    const raw = new URL(req.url).searchParams.get("ticket") ?? "";
    const ticket = await verifyTicket(env.TICKET_SECRET, raw, code, deps.now());
    if (!ticket) return refuseSocket(Close.BadTicket, "bad or expired ticket");
    const headers = new Headers({ Upgrade: "websocket", [TICKET_HEADER]: JSON.stringify(ticket) });
    return stubFor(env, code).fetch(new Request("https://room/connect", { headers }));
  }

  return async function handle(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] === "rooms" && parts.length === 1 && req.method === "POST") return await createRoom(req, env);
      if (parts[0] === "rooms" && parts.length >= 2) {
        const code = normalizeCode(decodeURIComponent(parts[1]));
        if (!code) return json(404, { error: "no such room" });
        if (parts.length === 2 && req.method === "GET") {
          await verifierFor(env)(/^Bearer (.+)$/.exec(req.headers.get("Authorization") ?? "")?.[1] ?? "");
          const s = await summaryOf(env, code);
          return s ? json(200, s) : json(404, { error: "no such room" });
        }
        if (parts[2] === "ticket" && req.method === "POST") return await ticketFor(req, env, code);
        if (parts[2] === "ws" && req.method === "GET") return await socket(req, env, code);
      }
      if (parts[0] === "j" && parts[1]) {
        const code = normalizeCode(parts[1]);
        if (!code) return new Response("Not found", { status: 404 });
        return new Response(joinPage(code), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      return json(404, { error: "not found" });
    } catch (e) {
      if (e instanceof AuthError) return json(e.status, { error: e.message });
      return json(500, { error: "internal" });
    }
  };
}

/** What a phone shows after scanning the QR: the code to type on another TV. Nothing about the room leaks. */
function joinPage(code: string): string {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch party ${code}</title><body style="font:20px system-ui;background:#111;color:#eee;text-align:center;padding:15vh 16px"><p>Watch party code</p><p style="font-size:48px;letter-spacing:.2em;font-weight:700">${code}</p><p>On your TV, open Secretary Nest › Watch together and enter this code.</p></body>`;
}

const handler = createHandler({ fetch: (input, init) => fetch(input, init), now: () => Date.now() });

export default {
  fetch: (req: Request, env: Env) => handler(req, env),
};
