import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type KV,
  type NuvioClient,
  approveQrLogin,
  avatarCatalog,
  exchangeQrLogin,
  avatarImage,
  createClient,
  decodeLaunch,
  encodeLaunch,
  jwtClaims,
  listProfiles,
  mintAppSession,
  readLaunch,
  nuvioConfig,
  ping,
  signInPassword,
  signOut,
  startQrLogin,
  toSession,
  verifyPin,
  waitForQrLogin,
} from "../src/index.ts";

const API = "https://api.example";
const config = nuvioConfig(API, "pk_test");

const memoryKv = (): KV & { map: Map<string, unknown> } => {
  const map = new Map<string, unknown>();
  return { map, get: (k) => (map.has(k) ? (structuredClone(map.get(k)) as never) : null), set: (k, v) => void map.set(k, structuredClone(v)) };
};

interface Call {
  url: string;
  method: string;
  auth?: string;
  apikey?: string;
  body?: unknown;
}

type Route = (call: Call) => Response | Promise<Response>;

/** Routes match on "METHOD path-prefix" (path after the API host); every call is recorded. */
function fakeFetch(routes: Record<string, Route>, calls: Call[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const h = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url,
      method: init.method ?? "GET",
      auth: h.authorization,
      apikey: h.apikey,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const path = url.slice(API.length);
    const hit = Object.entries(routes).find(([k]) => {
      const [m, p] = k.split(" ");
      return m === call.method && path.startsWith(p);
    });
    return hit ? hit[1](call) : new Response(JSON.stringify({ message: "no route" }), { status: 404 });
  }) as typeof fetch;
}

const json = (v: unknown, status = 200) => () => new Response(JSON.stringify(v), { status });
const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: Record<string, unknown>) => `${b64url({ alg: "none" })}.${b64url(claims)}.sig`;
const tokens = (sub: string, n: number, extra: Record<string, unknown> = {}) => ({
  access_token: jwt({ sub, n, ...extra }),
  refresh_token: `r-${sub}-${n}`,
  expires_in: 3600,
  user: { id: sub },
});

function client(routes: Record<string, Route>, clock = { t: 1_000_000 }, kv = memoryKv(), calls: Call[] = []) {
  const c = createClient({ config, kv, fetch: fakeFetch(routes, calls), now: () => clock.t });
  return { c, clock, kv, calls };
}

const signedIn = (c: NuvioClient, clock: { t: number }, access = "a1") =>
  c.session.set({ access, refresh: "r1", exp: clock.t + 3600_000, userId: "u1", anonymous: false });

test("config: env values over the public defaults, no trailing slash", () => {
  assert.deepEqual(nuvioConfig("https://self.host/", "k"), { url: "https://self.host", key: "k" });
  assert.equal(nuvioConfig().url, "https://api.nuvio.tv");
  assert.ok(nuvioConfig().key.startsWith("sb_publishable_"));
});

test("session: token bodies, camel-cased and nested exchange bodies, JWT fallbacks", () => {
  assert.equal(jwtClaims(jwt({ sub: "ü-1" })).sub, "ü-1");
  assert.deepEqual(jwtClaims("not a jwt"), {});
  const s = toSession(tokens("u1", 1), 1000)!;
  assert.deepEqual([s.userId, s.exp, s.anonymous, s.refresh], ["u1", 1000 + 3600_000, false, "r-u1-1"]);
  const nested = toSession({ session: { accessToken: jwt({ sub: "u2", exp: 50, is_anonymous: true }), refreshToken: "r" } }, 0)!;
  assert.deepEqual([nested.userId, nested.exp, nested.anonymous], ["u2", 50_000, true]);
  assert.equal(toSession({ access_token: "x" }, 0), null);
});

test("sign-in: password grant stores the session; it survives a restart; sign-out clears it even offline", async () => {
  const calls: Call[] = [];
  const { c, kv } = client({ "POST /auth/v1/token?grant_type=password": json(tokens("u1", 1)) }, undefined, undefined, calls);
  await signInPassword(c, " me@example.com ", "pw");
  assert.deepEqual(calls[0].body, { email: "me@example.com", password: "pw" });
  assert.equal(calls[0].apikey, "pk_test");
  assert.ok(c.session.signedIn());

  const again = createClient({ config, kv, fetch: fakeFetch({}) });
  assert.equal(again.session.get()?.userId, "u1");

  const offline = createClient({ config, kv, fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
  await signOut(offline);
  assert.equal(offline.session.get(), null);
  assert.equal(kv.map.get("sectv.nuvio.session"), null);
});

test("sign-in: a wrong password surfaces the server's message", async () => {
  const { c } = client({ "POST /auth/v1/token": json({ error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400) });
  await assert.rejects(signInPassword(c, "a@b.c", "x"), (e: Error & { code?: string; status?: number }) =>
    e.status === 400 && e.code === "invalid_credentials" && /Invalid login/.test(e.message));
  assert.equal(c.session.get(), null);
});

test("rpc: carries apikey and bearer; renews 30 s before expiry, once for parallel calls", async () => {
  let refreshes = 0;
  const calls: Call[] = [];
  const { c, clock } = client(
    {
      "POST /auth/v1/token?grant_type=refresh_token": async () => {
        refreshes++;
        await new Promise((r) => setTimeout(r, 5));
        return json(tokens("u1", refreshes))();
      },
      "POST /rest/v1/rpc/sync_pull_profiles": json([]),
    },
    undefined,
    undefined,
    calls,
  );
  signedIn(c, clock);
  await c.rpc("sync_pull_profiles");
  assert.equal(calls.at(-1)!.auth, "Bearer a1");
  assert.equal(calls.at(-1)!.apikey, "pk_test");

  clock.t += 3600_000 - 20_000;
  await Promise.all([c.rpc("sync_pull_profiles"), c.rpc("sync_pull_profiles"), c.rpc("sync_pull_profiles")]);
  assert.equal(refreshes, 1);
  assert.deepEqual(calls.find((x) => x.url.includes("refresh_token"))!.body, { refresh_token: "r1" });
  assert.equal(c.session.get()?.refresh, "r-u1-1");
  assert.ok(calls.slice(-3).every((x) => x.auth === `Bearer ${tokens("u1", 1).access_token}`));
});

test("rpc: a 401 renews and retries once; a second 401 fails", async () => {
  let n = 0;
  let renewals = 1;
  const { c, clock } = client({
    "POST /auth/v1/token?grant_type=refresh_token": () => json(tokens("u1", ++renewals))(),
    "POST /rest/v1/rpc/sync_pull_profiles": (call) =>
      call.auth === "Bearer a1" ? json({ message: "JWT expired" }, 401)() : json([{ profile_index: 1, name: "Main" }])(),
    "POST /rest/v1/rpc/always_401": () => (n++, json({ message: "nope" }, 401)()),
  });
  signedIn(c, clock);
  assert.equal((await listProfiles(c))[0].name, "Main");
  await assert.rejects(c.rpc("always_401"), (e: Error & { status?: number }) => e.status === 401);
  assert.equal(n, 2);
});

test("refresh: invalid grant signs out; a 5xx or no network keeps the session", async () => {
  let mode: "dead" | "down" | "offline" = "down";
  const { c, clock } = client({
    "POST /auth/v1/token?grant_type=refresh_token": () => {
      if (mode === "offline") throw new Error("offline");
      return mode === "dead"
        ? json({ error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }, 400)()
        : json({ message: "busy" }, 503)();
    },
  });
  const changes: number[] = [];
  c.session.subscribe(() => changes.push(clock.t));
  signedIn(c, clock);
  clock.t += 3600_000;
  assert.equal(await c.token(), "a1");
  mode = "offline";
  assert.equal(await c.token(), "a1");
  assert.ok(c.session.signedIn());
  mode = "dead";
  assert.equal(await c.token(), null);
  assert.equal(c.session.get(), null);
  assert.equal(changes.length, 2);
});

test("profiles: slot order, bad slots dropped, defaults filled; switching account resets the profile", async () => {
  const { c, clock } = client({
    "POST /rest/v1/rpc/sync_pull_profiles": json([
      { profile_index: 3, name: "Kids", avatar_color_hex: "#FF5722", pin_enabled: true, uses_primary_addons: true },
      { profile_index: 1, name: " ", avatar_id: "cat" },
      { profile_index: 9, name: "Out of range" },
    ]),
    "POST /rest/v1/rpc/get_avatar_catalog": json([
      { id: "cat", storage_path: "avatars/cat.png" },
      { id: "dog", storage_path: "dog.png" },
      { id: "old", storage_path: "old.png", is_active: false },
    ]),
  });
  signedIn(c, clock);
  const list = await listProfiles(c);
  assert.deepEqual(list.map((p) => [p.index, p.name, p.color, p.locked, p.usesPrimaryAddons]), [
    [1, "Profile 1", "#1E88E5", false, false],
    [3, "Kids", "#FF5722", true, true],
  ]);
  const catalog = await avatarCatalog(c);
  assert.equal(avatarImage(list[0], catalog), `${API}/storage/v1/object/public/avatars/cat.png`);
  assert.equal(catalog.get("dog"), `${API}/storage/v1/object/public/avatars/dog.png`);
  assert.ok(!catalog.has("old"));
  assert.equal(avatarImage({ avatarUrl: "https://img/x.png", avatarId: "cat" }, catalog), "https://img/x.png");

  c.session.setProfile(3);
  signedIn(c, clock, "a2");
  assert.equal(c.session.profile(), 3, "a renewed token is the same account");
  c.session.set({ access: "b", refresh: "rb", exp: clock.t + 1, userId: "u2", anonymous: false });
  assert.equal(c.session.profile(), 1);
});

test("profiles: an account with none yet gets Main; PIN answers both shapes", async () => {
  const { c, clock } = client({
    "POST /rest/v1/rpc/sync_pull_profiles": json(null),
    "POST /rest/v1/rpc/verify_profile_pin": (call) =>
      (call.body as { p_pin: string }).p_pin === "1234"
        ? json({ unlocked: true })()
        : json([{ unlocked: false, retry_after_seconds: 30 }])(),
  });
  signedIn(c, clock);
  assert.deepEqual((await listProfiles(c)).map((p) => p.name), ["Main"]);
  assert.deepEqual(await verifyPin(c, 2, "1234"), { unlocked: true });
  assert.deepEqual(await verifyPin(c, 2, "0000"), { unlocked: false, retryAfterSec: 30 });
});

test("QR: anonymous session first, then start; falls back without a device name", async () => {
  const calls: Call[] = [];
  let starts = 0;
  const { c } = client(
    {
      "POST /auth/v1/signup": json(tokens("anon", 1, { is_anonymous: true })),
      "POST /rest/v1/rpc/start_tv_login_session": (call) => {
        starts++;
        if ("p_device_name" in (call.body as object))
          return json({ code: "42883", message: "function start_tv_login_session(p_device_name ...) does not exist" }, 404)();
        return json([{ code: "ABC123", web_url: "https://nuvio.tv/tv-login?code=ABC123", poll_interval_seconds: 1, expires_at: "1970-01-01T00:20:00Z" }])();
      },
    },
    undefined,
    undefined,
    calls,
  );
  const login = await startQrLogin(c);
  assert.equal(calls[0].url, `${API}/auth/v1/signup`);
  assert.deepEqual(calls[0].body, { data: { tv_client: "tizen" } });
  assert.equal(c.session.get()?.anonymous, true);
  assert.ok(!c.session.signedIn());
  assert.equal(starts, 2);
  const start = calls.at(-1)!;
  assert.equal(start.auth, `Bearer ${tokens("anon", 1, { is_anonymous: true }).access_token}`);
  assert.equal((start.body as { p_device_nonce: string }).p_device_nonce, login.nonce);
  assert.match(login.nonce, /^[0-9a-f-]{36}$/);
  assert.deepEqual([login.code, login.url, login.intervalMs, login.expiresAt], ["ABC123", "https://nuvio.tv/tv-login?code=ABC123", 2000, 1_200_000]);
});

test("QR: polls until approved, rides out a 503, exchanges and replaces the anonymous session", async () => {
  const polls: string[] = ["pending", "503", "pending", "approved"];
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const { c, clock } = client(
    {
      "POST /rest/v1/rpc/poll_tv_login_session": () => {
        const next = polls.shift()!;
        return next === "503" ? json({ message: "busy" }, 503)() : json([{ status: next, poll_interval_seconds: 4 }])();
      },
      "POST /functions/v1/tv-logins-exchange": json({ session: { accessToken: jwt({ sub: "u9" }), refreshToken: "r9", expires_in: 60 } }),
    },
    undefined,
    undefined,
    calls,
  );
  c.session.set({ access: "anon", refresh: "ra", exp: clock.t + 3600_000, userId: "anon", anonymous: true });
  const login = { code: "C", nonce: "N", url: "u", expiresAt: clock.t + 600_000, intervalMs: 3000 };
  const outcome = await waitForQrLogin(c, login, { sleep: async (ms) => void (sleeps.push(ms), (clock.t += ms)) });
  assert.equal(outcome, "signed-in");
  assert.deepEqual(sleeps, [4000, 4000, 4000]);
  assert.deepEqual(calls.find((x) => x.url.endsWith("tv-logins-exchange"))!.body, { code: "C", device_nonce: "N" });
  assert.deepEqual(calls[0].body, { p_code: "C", p_device_nonce: "N" });
  assert.equal(c.session.get()?.userId, "u9");
  assert.ok(c.session.signedIn());
});

test("QR: expiry, a cancelled login, leaving the screen, and a hard 4xx", async () => {
  const sleep = (clock: { t: number }) => async (ms: number) => void (clock.t += ms);
  const pending = { "POST /rest/v1/rpc/poll_tv_login_session": json({ status: "pending" }) };
  const a = client(pending);
  const login = { code: "C", nonce: "N", url: "u", expiresAt: a.clock.t + 10_000, intervalMs: 3000 };
  assert.equal(await waitForQrLogin(a.c, login, { sleep: sleep(a.clock) }), "expired");

  const b = client({ "POST /rest/v1/rpc/poll_tv_login_session": json({ status: "canceled" }) });
  assert.equal(await waitForQrLogin(b.c, { ...login, expiresAt: b.clock.t + 10_000 }, { sleep: sleep(b.clock) }), "cancelled");

  const d = client(pending);
  const ac = new AbortController();
  const left = waitForQrLogin(d.c, { ...login, expiresAt: Infinity }, { signal: ac.signal, sleep: async () => ac.abort() });
  assert.equal(await left, "cancelled");

  const e = client({ "POST /rest/v1/rpc/poll_tv_login_session": json({ message: "bad nonce" }, 400) });
  await assert.rejects(waitForQrLogin(e.c, { ...login, expiresAt: Infinity }, { sleep: sleep(e.clock) }), /bad nonce/);
});

test("QR: Nest approves an app's code with its own session; a refusal throws", async () => {
  const calls: Call[] = [];
  const { c, clock } = client(
    {
      "POST /rest/v1/rpc/approve_tv_login_session": (call) =>
        (call.body as { p_code: string }).p_code === "GOOD"
          ? json([{ success: true, message: "TV login approved" }])()
          : json([{ success: false, message: "Code expired" }])(),
    },
    undefined,
    undefined,
    calls,
  );
  signedIn(c, clock);
  await approveQrLogin(c, "GOOD");
  assert.equal(calls[0].auth, "Bearer a1");
  await assert.rejects(approveQrLogin(c, "OLD"), /Code expired/);
});

test("QR: the exchange's flat body (no user) takes the id from the JWT", async () => {
  const { c, clock } = client({
    "POST /functions/v1/tv-logins-exchange": json({ access_token: jwt({ sub: "u7", session_id: "s2" }), refresh_token: "r7", token_type: "bearer", expires_in: 3600 }),
  });
  c.session.set({ access: "anon", refresh: "ra", exp: clock.t + 3600_000, userId: "anon", anonymous: true });
  await exchangeQrLogin(c, { code: "C", nonce: "N", url: "u", expiresAt: Infinity, intervalMs: 3000 });
  assert.deepEqual([c.session.get()?.userId, c.session.signedIn()], ["u7", true]);
});

test("mint: an app session of its own — anonymous login, approved by Nest, exchanged; Nest's session untouched", async () => {
  const calls: Call[] = [];
  const anon = tokens("anon2", 1, { is_anonymous: true });
  let approvedBy = "";
  const { c, clock, kv } = client(
    {
      "POST /auth/v1/signup": json(anon),
      "POST /rest/v1/rpc/start_tv_login_session": json([{ code: "K1", web_url: "https://nuvio.tv/tv-login?code=K1", poll_interval_seconds: 3 }]),
      "POST /rest/v1/rpc/approve_tv_login_session": (call) => ((approvedBy = call.auth ?? ""), json([{ success: true }])()),
      "POST /rest/v1/rpc/poll_tv_login_session": (call) =>
        json([{ status: call.auth === `Bearer ${anon.access_token}` && approvedBy ? "approved" : "pending" }])(),
      "POST /functions/v1/tv-logins-exchange": json({ access_token: jwt({ sub: "u1", session_id: "app" }), refresh_token: "r-app", expires_in: 3600 }),
    },
    undefined,
    undefined,
    calls,
  );
  signedIn(c, clock);
  const before = structuredClone(kv.map.get("sectv.nuvio.session"));
  const app = await mintAppSession(c, { deviceName: "Secretary Cinema", sleep: async () => {} });
  assert.deepEqual([app.userId, app.refresh, app.anonymous], ["u1", "r-app", false]);
  assert.equal(approvedBy, "Bearer a1", "Nest's own session approves");
  assert.equal((calls[1].body as { p_device_name: string }).p_device_name, "Secretary Cinema");
  assert.deepEqual(kv.map.get("sectv.nuvio.session"), before);

  const out = client({});
  await assert.rejects(mintAppSession(out.c), /not signed in/);
});

test("launch payload: round-trips; bad grants, kinds and versions are dropped", () => {
  const session = { access: "a", refresh: "r", exp: 5, userId: "u", anonymous: false };
  const title = { id: "tt1", name: "Film", poster: "p" };
  const raw = encodeLaunch({ at: 9, grant: { session, profile: 3 }, open: { type: "series", title, autoPlay: true } });
  assert.deepEqual(decodeLaunch(raw), { v: 1, at: 9, grant: { session, profile: 3 }, open: { type: "series", title, autoPlay: true } });
  assert.deepEqual(
    decodeLaunch(JSON.stringify({ v: 1, at: 1, grant: { session: { ...session, anonymous: true }, profile: 1 }, open: { type: "book", title } })),
    { v: 1, at: 1 },
  );
  assert.equal(decodeLaunch(JSON.stringify({ v: 1, at: 1, grant: { session, profile: 7 } }))?.grant, undefined);
  assert.equal(decodeLaunch(JSON.stringify({ v: 2, at: 1 })), null);
  assert.equal(decodeLaunch("{nope"), null);
  assert.equal(decodeLaunch(undefined), null);
  assert.equal(readLaunch(), null, "no tizen here");
});

test("launch payload: Nest's SmartThings token and scenes travel; a malformed grant is dropped", () => {
  const home = { token: "t", exp: 5, movie: "scene-movie", restore: "scene-bright" };
  assert.deepEqual(decodeLaunch(encodeLaunch({ at: 3, home }))?.home, home);
  assert.deepEqual(decodeLaunch(encodeLaunch({ at: 3, home: { token: "t", exp: 5, movie: "" } }))?.home, { token: "t", exp: 5 });
  assert.equal(decodeLaunch(JSON.stringify({ v: 1, at: 3, home: { token: "", exp: 5 } }))?.home, undefined);
  assert.equal(decodeLaunch(JSON.stringify({ v: 1, at: 3, home: { token: "t" } }))?.home, undefined);
});

test("launch payload: a watch-party code travels with the title; a malformed one is dropped", () => {
  const title = { id: "tt1:1:2", name: "Show" };
  const open = (room: string) => decodeLaunch(encodeLaunch({ at: 2, open: { type: "series", title, autoPlay: false, room } }))?.open;
  assert.equal(open("ABC234")?.room, "ABC234");
  assert.equal(open("abc234")?.room, undefined, "codes are normalised before they are sent");
  assert.equal(open("ABC0I1")?.room, undefined);
  assert.equal(open("ABC234</script>")?.room, undefined);
});

test("ping: true only when the database answers", async () => {
  assert.equal(await ping(client({ "POST /rest/v1/rpc/health_ping": json(true) }).c), true);
  assert.equal(await ping(client({}).c), false);
});
