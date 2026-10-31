import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeUrl,
  homeAction,
  homeAlerts,
  oauthTokens,
  type RawDevice,
  roomLux,
  smartThings,
  type StDevice,
  type StTokens,
  toDevice,
} from "../src/index.ts";

const status = (caps: Record<string, Record<string, unknown>>) =>
  Object.entries(caps).map(([id, attrs]) => ({
    id,
    status: Object.fromEntries(Object.entries(attrs).map(([k, value]) => [k, { value }])),
  }));

// A home like the reference one, with placeholder ids.
const RAW: RawDevice[] = [
  { deviceId: "dev-couch", label: "Couch light", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "on" }, switchLevel: { level: 80 } }) }] },
  { deviceId: "dev-desk", label: "Desk lamp", type: "MATTER", executionContext: "LOCAL", components: [{ id: "main", capabilities: status({ switch: { switch: "off" } }) }] },
  { deviceId: "dev-phone", label: "Alex's phone", type: "MOBILE", components: [{ id: "main", capabilities: status({ presenceSensor: { presence: "present" } }) }] },
  { deviceId: "dev-vac", label: "POWERbot", type: "OCF", ocf: { ocfDeviceType: "oic.d.robotcleaner" }, components: [{ id: "main", capabilities: status({ switch: { switch: "off" }, robotCleanerMovement: { robotCleanerMovement: "charging" } }) }] },
  { deviceId: "dev-tv", label: "TV", type: "OCF", ocf: { ocfDeviceType: "oic.d.tv" }, components: [{ id: "main", capabilities: status({ switch: { switch: "on" } }) }] },
  { deviceId: "dev-lux", label: "TV light sensor", type: "OCF", ocf: { ocfDeviceType: "x.com.st.d.sensor.light" }, components: [{ id: "main", capabilities: status({ switch: { switch: "on" }, illuminanceMeasurement: { illuminance: 42 } }) }] },
  { deviceId: "dev-hub", label: "Hub", type: "HUB" },
];
const DEVICES = RAW.map(toDevice).filter((d): d is StDevice => d !== null);
const SCENES = [
  { id: "scene-movie", name: "Couch light Turn off" },
  { id: "scene-bright", name: "energetic lights" },
];

test("devices are sorted into kinds, with their status", () => {
  assert.deepEqual(
    DEVICES.map((d) => [d.id, d.kind]),
    [["dev-couch", "light"], ["dev-desk", "light"], ["dev-phone", "phone"], ["dev-vac", "vacuum"], ["dev-tv", "tv"], ["dev-lux", "lightSensor"]],
  );
  const couch = DEVICES[0];
  assert.deepEqual([couch.on, couch.level, couch.dimmable, couch.local], [true, 80, true, false]);
  assert.equal(DEVICES[1].local, true);
  assert.equal(DEVICES[2].present, true);
  assert.equal(DEVICES[3].vacuum, "charging");
  assert.equal(roomLux(DEVICES), 42);
});

test("alerts: arrivals, departures and the vacuum's round", () => {
  const with_ = (id: string, patch: Partial<StDevice>) => DEVICES.map((d) => (d.id === id ? { ...d, ...patch } : d));
  assert.deepEqual(homeAlerts(DEVICES, DEVICES), []);
  assert.deepEqual(homeAlerts(DEVICES, with_("dev-phone", { present: false })).map((a) => a.text), ["🚪 Alex's phone left"]);
  const cleaning = with_("dev-vac", { vacuum: "cleaning" });
  assert.deepEqual(homeAlerts(DEVICES, cleaning).map((a) => a.text), ["🧹 POWERbot started cleaning"]);
  const homing = with_("dev-vac", { vacuum: "homing" });
  assert.deepEqual(homeAlerts(cleaning, homing), []);
  assert.deepEqual(homeAlerts(homing, DEVICES).map((a) => a.text), ["✅ POWERbot finished and is charging"]);
  assert.deepEqual(homeAlerts(cleaning, with_("dev-vac", { vacuum: "alarm" })).map((a) => a.text), ["⚠️ POWERbot needs help"]);
});

test("prompts that name a scene, a light, the lights or the vacuum", () => {
  const act = (p: string) => homeAction(p, DEVICES, SCENES);
  const scene = act("Run couch light turn off");
  assert.equal(scene?.kind === "scene" && scene.scene.id, "scene-movie");
  assert.equal(act("energetic lights please")?.kind, "scene");

  const off = act("Turn off the couch light.");
  assert.ok(off?.kind === "devices");
  assert.deepEqual(off.targets.map((t) => [t.device.id, t.commands.map((c) => c.command)]), [["dev-couch", ["off"]]]);
  assert.equal(off.reply, "Turning off Couch light.");

  const dim = act("set the couch light to 25%");
  assert.ok(dim?.kind === "devices");
  assert.deepEqual(dim.targets[0].commands.map((c) => [c.command, c.arguments]), [["on", undefined], ["setLevel", [25]]]);
  assert.equal(dim.reply, "Setting Couch light to 25%.");

  // The desk lamp has no level: it just turns on.
  const all = act("dim the lights to 20 percent");
  assert.ok(all?.kind === "devices");
  assert.deepEqual(all.targets.map((t) => [t.device.id, t.commands.length]), [["dev-couch", 2], ["dev-desk", 1]]);

  assert.equal((act("lights off") as { targets: unknown[] }).targets.length, 2);

  const vac = act("start the vacuum");
  assert.ok(vac?.kind === "devices");
  assert.deepEqual(vac.targets[0].commands.map((c) => c.arguments?.[0]), ["auto", "cleaning"]);
  const dock = act("send the robot back home");
  assert.ok(dock?.kind === "devices");
  assert.deepEqual(dock.targets[0].commands.map((c) => c.arguments?.[0]), ["homing"]);

  assert.equal(act("play something on the big screen"), null);
  assert.equal(act("remind me to water the plants"), null);
  assert.equal(act("the couch light"), null);
});

test("the client sends commands, runs scenes, and refreshes once on a 401", async () => {
  const calls: string[] = [];
  let tokenCalls = 0;
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const auth = (init?.headers as Record<string, string>).authorization;
    calls.push(`${init?.method ?? "GET"} ${u.replace("https://api.smartthings.com/v1", "")} ${auth} ${init?.body ?? ""}`);
    if (auth === "Bearer old") return new Response("", { status: 401 });
    if (u.includes("/devices?")) return new Response(JSON.stringify({ items: RAW }));
    if (u.endsWith("/scenes")) return new Response(JSON.stringify({ items: [{ sceneId: "scene-movie", sceneName: " Couch light Turn off " }] }));
    return new Response("");
  }) as typeof fetch;
  const st = smartThings({ token: async (force) => (++tokenCalls, force ? "new" : "old"), fetch: f });

  assert.equal((await st.devices()).length, 6);
  assert.equal(tokenCalls, 2);
  assert.deepEqual(await st.scenes(), [{ id: "scene-movie", name: "Couch light Turn off" }]);
  await st.runScene("scene-movie");
  await st.command("dev-couch", [{ capability: "switch", command: "off" }]);
  const sent = calls.filter((c) => c.includes("Bearer new"));
  assert.match(sent.at(-2)!, /^POST \/scenes\/scene-movie\/execute /);
  assert.equal(
    sent.at(-1),
    'POST /devices/dev-couch/commands Bearer new {"commands":[{"component":"main","arguments":[],"capability":"switch","command":"off"}]}',
  );
});

test("OAuth: the consent link, and refreshes saved before use, one at a time", async () => {
  const url = new URL(authorizeUrl("client-1", "https://example.com/cb", "s1", "chal"));
  assert.equal(url.origin + url.pathname, "https://api.smartthings.com/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "r:devices:* x:devices:* r:scenes:* x:scenes:* r:locations:*");
  assert.deepEqual([url.searchParams.get("code_challenge"), url.searchParams.get("code_challenge_method")], ["chal", null]);
  assert.equal(new URL(authorizeUrl("client-1", "https://example.com/cb", "s1")).searchParams.has("code_challenge"), false);

  let now = 1_000_000;
  let saved: StTokens | null = { access: "a1", refresh: "r1", exp: now + 24 * 3600_000 };
  const store = { load: () => saved, save: (t: StTokens) => (saved = t) };
  const bodies: string[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(`${(init?.headers as Record<string, string>).authorization} ${init?.body}`);
    const n = bodies.length + 1;
    return new Response(JSON.stringify({ access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 86_400 }));
  }) as typeof fetch;
  const token = oauthTokens({ clientId: "client-1", clientSecret: "secret" }, store, f, () => now);

  assert.equal(await token(), "a1");
  assert.equal(bodies.length, 0);

  now += 23.5 * 3600_000; // within the hour before expiry
  const [x, y] = await Promise.all([token(), token()]);
  assert.deepEqual([x, y], ["a2", "a2"]);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0], `Basic ${btoa("client-1:secret")} grant_type=refresh_token&refresh_token=r1&client_id=client-1`);
  assert.equal(saved?.refresh, "r2");

  assert.equal(await token(true), "a3");
  assert.equal(saved?.refresh, "r3");

  saved = null;
  assert.equal(await token(), null);
});

test("an early refresh that fails keeps the current token until it expires", async () => {
  const now = 0;
  const saved: StTokens = { access: "a1", refresh: "r1", exp: 30 * 60_000 };
  const f = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
  const token = oauthTokens({ clientId: "c", clientSecret: "s" }, { load: () => saved, save: () => {} }, f, () => now);
  assert.equal(await token(), "a1");
  await assert.rejects(token(true), /SmartThings token: 503/);
});
