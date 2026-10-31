import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthError, bytesToB64url, createJwtVerifier, fetchProfile } from "../src/auth.ts";
import { signTicket, verifyTicket } from "../src/ticket.ts";
import { createHandler, newCode, normalizeCode, CODE_ALPHABET, type Env } from "../src/worker.ts";
import { PartyRoom } from "../src/do.ts";
import { ServerClock, correction, DRIFT } from "../src/sync.ts";
import type { StorageLike } from "../src/cf.ts";
import type { Timeline } from "../src/protocol.ts";

const NUVIO = "https://nuvio.test";
const ISSUER = `${NUVIO}/auth/v1`;
const NOW = 1_800_000_000_000;
const enc = new TextEncoder();

async function es256() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
  const sign = async (claims: object, header: object = { alg: "ES256", kid: "k1", typ: "JWT" }) => {
    const head = `${bytesToB64url(enc.encode(JSON.stringify(header)))}.${bytesToB64url(enc.encode(JSON.stringify(claims)))}`;
    const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, enc.encode(head));
    return `${head}.${bytesToB64url(sig)}`;
  };
  return { jwk, sign };
}

const claims = (extra: object = {}) => ({
  sub: "user-1",
  aud: "authenticated",
  role: "authenticated",
  iss: ISSUER,
  exp: NOW / 1000 + 3600,
  ...extra,
});

function jwksFetch(keys: object[]) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ keys }), { status: 200 });
  }) as typeof fetch;
  return { f, calls };
}

test("an ES256 Nuvio token verifies, and the key set is fetched once", async () => {
  const { jwk, sign } = await es256();
  const { f, calls } = jwksFetch([jwk]);
  const verify = createJwtVerifier({ jwksUrl: `${ISSUER}/.well-known/jwks.json`, issuer: ISSUER, fetch: f, now: () => NOW });
  assert.equal((await verify(await sign(claims()))).sub, "user-1");
  await verify(await sign(claims()));
  assert.equal(calls.length, 1);
});

test("an RS256 token verifies too", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "r1" };
  const head = `${bytesToB64url(enc.encode('{"alg":"RS256","kid":"r1"}'))}.${bytesToB64url(enc.encode(JSON.stringify(claims())))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, enc.encode(head));
  const verify = createJwtVerifier({ jwksUrl: "x", issuer: ISSUER, fetch: jwksFetch([jwk]).f, now: () => NOW });
  assert.equal((await verify(`${head}.${bytesToB64url(sig)}`)).sub, "user-1");
});

test("expired, foreign, anonymous, tampered and unsigned tokens are refused", async () => {
  const { jwk, sign } = await es256();
  const verify = createJwtVerifier({ jwksUrl: "x", issuer: ISSUER, fetch: jwksFetch([jwk]).f, now: () => NOW });
  const refused = async (token: string, why: RegExp) => {
    await assert.rejects(verify(token), (e: unknown) => e instanceof AuthError && why.test(e.message));
  };
  await refused(await sign(claims({ exp: NOW / 1000 - 120 })), /expired/);
  await refused(await sign(claims({ iss: "https://elsewhere/auth/v1" })), /issuer/);
  await refused(await sign(claims({ aud: "anon" })), /audience/);
  await refused(await sign(claims({ is_anonymous: true })), /anonymous/);
  const good = await sign(claims());
  const [h, , s] = good.split(".");
  await refused(`${h}.${bytesToB64url(enc.encode(JSON.stringify(claims({ sub: "admin" }))))}.${s}`, /signature/);
  await refused(await sign(claims(), { alg: "HS256", kid: "k1" }), /algorithm/);
  await refused(`${bytesToB64url(enc.encode('{"alg":"none"}'))}.${good.split(".")[1]}.`, /algorithm/);
});

test("an unknown key id refetches the key set, but not more than once per gap", async () => {
  const { jwk, sign } = await es256();
  let keys: object[] = [];
  let fetches = 0;
  let now = NOW;
  const f = (async () => {
    fetches++;
    return new Response(JSON.stringify({ keys }));
  }) as typeof fetch;
  const verify = createJwtVerifier({ jwksUrl: "x", issuer: ISSUER, fetch: f, now: () => now, refetchGapMs: 30_000 });
  await assert.rejects(verify(await sign(claims())), /unknown signing key/);
  keys = [jwk]; // Nuvio rotates in a new key.
  await assert.rejects(verify(await sign(claims())), /unknown signing key/);
  assert.equal(fetches, 1);
  now += 30_000;
  assert.equal((await verify(await sign(claims()))).sub, "user-1");
  assert.equal(fetches, 2);
});

function profilesFetch(rows: object[] | null, status = 200) {
  const seen: { url: string; auth: string | null; apikey: string | null }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen.push({ url: String(url), auth: h.get("Authorization"), apikey: h.get("apikey") });
    return new Response(JSON.stringify(rows), { status });
  }) as typeof fetch;
  return { f, seen };
}

test("the profile check reads the account's own profiles with the caller's token", async () => {
  const { f, seen } = profilesFetch([
    { profile_index: 1, name: "Lucas", avatar_color_hex: "#FF0000" },
    { profile_index: 2, name: "  ", avatar_color_hex: "red; x" },
  ]);
  const p1 = await fetchProfile({ url: NUVIO, key: "pk", token: "tok", index: 1, fetch: f });
  assert.deepEqual(p1, { index: 1, name: "Lucas", color: "#FF0000" });
  assert.deepEqual(seen[0], { url: `${NUVIO}/rest/v1/rpc/sync_pull_profiles`, auth: "Bearer tok", apikey: "pk" });
  assert.deepEqual(await fetchProfile({ url: NUVIO, key: "pk", token: "tok", index: 2, fetch: f }), {
    index: 2,
    name: "Profile 2",
    color: "#1E88E5",
  });
  assert.equal(await fetchProfile({ url: NUVIO, key: "pk", token: "tok", index: 3, fetch: f }), null);
  const fresh = profilesFetch([]);
  assert.equal((await fetchProfile({ url: NUVIO, key: "pk", token: "t", index: 1, fetch: fresh.f }))?.name, "Main");
  await assert.rejects(fetchProfile({ url: NUVIO, key: "pk", token: "t", index: 1, fetch: profilesFetch(null, 401).f }), AuthError);
});

test("tickets verify for their room only, until they expire, and not when tampered", async () => {
  const member = { id: "u:1", name: "U", color: "#000000" };
  const t = await signTicket("secret", { room: "K7QX2M", member, exp: NOW + 60_000 });
  assert.equal((await verifyTicket("secret", t, "K7QX2M", NOW))?.member.id, "u:1");
  assert.equal(await verifyTicket("secret", t, "AAAAAA", NOW), null);
  assert.equal(await verifyTicket("secret", t, "K7QX2M", NOW + 60_000), null);
  assert.equal(await verifyTicket("other", t, "K7QX2M", NOW), null);
  const [payload, sig] = t.split(".");
  const forged = bytesToB64url(enc.encode(JSON.stringify({ room: "K7QX2M", member: { id: "admin:1" }, exp: NOW + 1e9, id: "x" })));
  assert.equal(await verifyTicket("secret", `${forged}.${sig}`, "K7QX2M", NOW), null);
  assert.equal(await verifyTicket("secret", `${payload}`, "K7QX2M", NOW), null);
});

test("room codes use the unambiguous alphabet, and typed codes are forgiven", () => {
  for (let i = 0; i < 200; i++) {
    const c = newCode();
    assert.equal(c.length, 6);
    assert.equal([...c].every((ch) => CODE_ALPHABET.includes(ch)), true);
  }
  assert.equal(normalizeCode("k7q-x2m"), "K7QX2M");
  assert.equal(normalizeCode("K7QX2O"), null, "O is not in the alphabet");
  assert.equal(normalizeCode("K7QX2"), null);
});

function memoryStorage(): StorageLike & { data: Map<string, unknown>; alarm?: number } {
  const data = new Map<string, unknown>();
  const s = {
    data,
    alarm: undefined as number | undefined,
    get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
    deleteAll: async () => data.clear(),
    setAlarm: async (at: number) => void (s.alarm = at),
    deleteAlarm: async () => void (s.alarm = undefined),
  };
  return s;
}

async function service(profiles: object[] = [{ profile_index: 1, name: "Lucas", avatar_color_hex: "#112233" }]) {
  const { jwk, sign } = await es256();
  const rooms = new Map<string, { obj: PartyRoom; storage: ReturnType<typeof memoryStorage> }>();
  const env: Env = {
    NUVIO_URL: NUVIO,
    NUVIO_KEY: "pk",
    TICKET_SECRET: "test-secret",
    PUBLIC_URL: "https://party.test",
    ROOMS: {
      idFromName: (name) => name,
      get: (id) => {
        const name = String(id);
        if (!rooms.has(name)) {
          const storage = memoryStorage();
          rooms.set(name, { obj: new PartyRoom({ storage }, undefined, () => NOW), storage });
        }
        const { obj } = rooms.get(name)!;
        return { fetch: (input, init) => obj.fetch(input instanceof Request ? input : new Request(input, init)) };
      },
    },
  };
  const f = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/jwks.json")) return new Response(JSON.stringify({ keys: [jwk] }));
    if (String(url).endsWith("/rpc/sync_pull_profiles")) return new Response(JSON.stringify(profiles));
    throw new Error(`unexpected fetch ${url} ${init?.method}`);
  }) as typeof fetch;
  const handle = createHandler({ fetch: f, now: () => NOW });
  const token = await sign(claims());
  const call = (method: string, path: string, body?: object, auth = token) =>
    handle(
      new Request(`https://party.test${path}`, {
        method,
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    );
  return { call, rooms, sign };
}

const release = { infoHash: "ab".repeat(20), fileIdx: 3, size: 4_000_000_000 };

test("creating a room returns its code, a QR join link and a ticketed socket URL", async () => {
  const { call, rooms } = await service();
  const res = await call("POST", "/rooms", { profile: 1, contentId: "tt0111161", title: "A film", release, control: "shared" });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { code: string; joinUrl: string; wsUrl: string; room: { control: string; members: number } };
  assert.match(body.code, /^[2-9A-HJKMNP-Z]{6}$/);
  assert.equal(body.joinUrl, `https://party.test/j/${body.code}`);
  assert.ok(body.wsUrl.startsWith(`wss://party.test/rooms/${body.code}/ws?ticket=`));
  assert.equal(body.room.control, "shared");
  assert.equal(body.room.members, 0);
  const stored = rooms.get(body.code)!.storage;
  assert.equal((stored.data.get("room") as { hostId: string }).hostId, "user-1:1");
  assert.ok(stored.alarm, "an alarm is set for the room's next deadline");

  const ticket = decodeURIComponent(body.wsUrl.split("ticket=")[1]);
  const t = await verifyTicket("test-secret", ticket, body.code, NOW);
  assert.deepEqual(t?.member, { id: "user-1:1", name: "Lucas", color: "#112233" });

  const summary = await call("GET", `/rooms/${body.code.toLowerCase()}`);
  assert.equal(summary.status, 200);
  const joined = await call("POST", `/rooms/${body.code}/ticket`, { profile: 1 });
  assert.equal(joined.status, 200);
  const page = await call("GET", `/j/${body.code}`, undefined, "");
  assert.match(await page.text(), new RegExp(body.code));
});

test("a room needs a fingerprint, not a link, and a profile the account has", async () => {
  const { call } = await service();
  const bad = await call("POST", "/rooms", { profile: 1, contentId: "tt1", release: { url: "https://cdn/x.mkv" } });
  assert.equal(bad.status, 400);
  const otherProfile = await call("POST", "/rooms", { profile: 4, contentId: "tt1", release });
  assert.equal(otherProfile.status, 403);
  const anon = await call("POST", "/rooms", { profile: 1, contentId: "tt1", release }, "");
  assert.equal(anon.status, 401);
});

test("tickets are refused for rooms that do not exist", async () => {
  const { call } = await service();
  assert.equal((await call("POST", "/rooms/K7QX2M/ticket", { profile: 1 })).status, 404);
  assert.equal((await call("GET", "/rooms/K7QX2M")).status, 404);
  assert.equal((await call("GET", "/rooms/K7QX2M/ws")).status, 426, "a plain GET is not an upgrade");
});

test("the server clock keeps the lowest-RTT sample", () => {
  const c = new ServerClock(4);
  c.add(0, 1_000_150, 300); // rtt 300 → offset 999_000
  c.add(1_000, 1_000_550, 1_100); // rtt 100 → offset 999_500
  c.add(2_000, 1_001_700, 2_400); // rtt 400
  assert.deepEqual(c.best(), { rtt: 100, offset: 999_500 });
  assert.equal(c.toServer(5_000), 1_004_500);
  assert.equal(c.add(10, 0, 5), null, "a negative RTT is dropped");
  for (let i = 0; i < 4; i++) c.add(3_000 + i, 2_000_000, 3_200 + i);
  assert.equal(c.best()?.rtt, 200, "old samples age out");
});

test("drift is corrected by one rare reopen at a target that accounts for the reopen itself", () => {
  const tl: Timeline = {
    rev: 5,
    state: "playing",
    pos0: 100,
    t0: 50_000,
    contentId: "tt1",
    title: "",
    release,
    contentRev: 1,
    cause: "ready",
  };
  const at = 60_000; // target 110 s
  assert.deepEqual(correction({ tl, serverNow: at, localPos: 109, reopenMs: 3_000 }), { kind: "none" });
  assert.deepEqual(correction({ tl, serverNow: at, localPos: 110 - DRIFT.toleranceSec - 1, reopenMs: 3_000 }), {
    kind: "seek",
    to: 113,
  });
  assert.deepEqual(correction({ tl, serverNow: at, localPos: 100, lastSeekAt: at - 10_000, reopenMs: 3_000 }), {
    kind: "none",
  });
  assert.deepEqual(correction({ tl: { ...tl, state: "paused" }, serverNow: at, localPos: 0, reopenMs: 0 }), { kind: "none" });
});
