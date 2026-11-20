import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeUrl,
  cinemaShow,
  danceShow,
  fadeShow,
  homeAction,
  homeAlerts,
  isIndependent,
  moodMidpoint,
  moodShow,
  musicShow,
  nextPictureMode,
  oauthTokens,
  pictureScene,
  type RawDevice,
  resolvePictureMode,
  restoreCommands,
  rippleLevel,
  rippleShow,
  runShow,
  roomLux,
  sharedLights,
  type ShowStep,
  smartThings,
  stColour,
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

test("the TV's picture mode: read, set by prompt, and flipped between two favourites", () => {
  const tvRaw = (cap: string): RawDevice => ({
    deviceId: "dev-tv2",
    label: "Living room TV",
    type: "OCF",
    ocf: { ocfDeviceType: "oic.d.tv" },
    components: [{ id: "main", capabilities: status({ [cap]: { pictureMode: "Dynamic", supportedPictureModes: ["Dynamic", "Standard", "Natural", "Eco"] } }) }],
  });
  const tv = toDevice(tvRaw("custom.picturemode"))!;
  assert.deepEqual([tv.pictureMode, tv.pictureCap, tv.pictureModes], ["Dynamic", "custom.picturemode", ["Dynamic", "Standard", "Natural", "Eco"]]);
  assert.equal(toDevice(tvRaw("samsungvd.pictureMode"))!.pictureCap, "samsungvd.pictureMode");
  assert.equal(DEVICES.find((d) => d.kind === "tv")!.pictureMode, undefined);

  const act = (p: string) => homeAction(p, [...DEVICES, tv], SCENES);
  const eco = act("switch to echo mode");
  assert.ok(eco?.kind === "devices");
  assert.deepEqual(eco.targets.map((t) => [t.device.id, t.commands]), [["dev-tv2", [{ capability: "custom.picturemode", command: "setPictureMode", arguments: ["Eco"] }]]]);
  assert.equal(eco.reply, "Switching the picture to Eco.");
  assert.ok(act("picture mode standard")?.kind === "devices");
  // Without a TV that reports a picture mode, or without the words, nothing happens.
  assert.equal(homeAction("eco mode", DEVICES, SCENES), null);
  assert.equal(act("play something on the big screen"), null);

  // A scene named for the TV and the mode wins over the command: this TV obeys scenes but not the cloud command.
  const withScenes = [...SCENES, { id: "scene-eco", name: "TV Eco" }, { id: "scene-dyn", name: "TV Dynamic" }];
  assert.equal(pictureScene("Eco", withScenes)?.id, "scene-eco");
  assert.equal(pictureScene("Standard", withScenes), undefined);
  assert.equal(pictureScene("Eco", [{ id: "x", name: "Eco lights" }]), undefined);
  const viaScene = homeAction("echo mode", [...DEVICES, tv], withScenes);
  assert.ok(viaScene?.kind === "scene");
  assert.deepEqual([viaScene.scene.id, viaScene.picture, viaScene.reply], ["scene-eco", "Eco", "Switching the picture to Eco."]);
  // Even without a TV that reports the mode, a scene is enough.
  assert.equal(homeAction("dynamic picture", DEVICES, withScenes)?.kind, "scene");
  assert.equal(eco.picture, "Eco");

  assert.equal(resolvePictureMode("echo", tv.pictureModes), "Eco");
  assert.equal(resolvePictureMode("echo"), "Eco");
  assert.equal(resolvePictureMode("energy saving"), "Energy saving");
  assert.equal(nextPictureMode("Dynamic", ["Dynamic", "Eco"], tv.pictureModes), "Eco");
  assert.equal(nextPictureMode("Eco", ["Dynamic", "Eco"], tv.pictureModes), "Dynamic");
  // Any other mode, or an unknown one, goes to the first favourite.
  assert.equal(nextPictureMode("Standard", ["Dynamic", "Eco"], tv.pictureModes), "Dynamic");
  assert.equal(nextPictureMode(undefined, ["Dynamic", "Eco"]), "Dynamic");
});

// A living room like the reference one: three bulbs in the side lamp, a couch strip, a kitchen light, a sound system on a
// plug, and lights elsewhere that the shows leave alone.
const ROOM_RAW: RawDevice[] = [
  { deviceId: "side-top", label: "Side Light Top", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "on" }, switchLevel: { level: 80 } }) }] },
  { deviceId: "side-mid", label: "Side Light Mid", type: "MATTER", components: [{ id: "main", capabilities: status({ switch: { switch: "on" }, switchLevel: { level: 80 } }) }] },
  { deviceId: "side-low", label: "Side Light Low", type: "MATTER", components: [{ id: "main", capabilities: status({ switch: { switch: "off" }, switchLevel: { level: 80 } }) }] },
  { deviceId: "couch", label: "Couch light", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "on" } }) }] },
  { deviceId: "kitchen", label: "Kitchen Light", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "off" } }) }] },
  { deviceId: "sound", label: "sound system", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "off" } }) }] },
  { deviceId: "desk", label: "Computer Desk", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "on" } }) }] },
  { deviceId: "bedroom", label: "Bedroom light", type: "VIPER", components: [{ id: "main", capabilities: status({ switch: { switch: "on" }, switchLevel: { level: 50 } }) }] },
];
const ROOM = ROOM_RAW.map(toDevice).filter((d): d is StDevice => d !== null);
const flat = (steps: ShowStep[]) => steps.map((s) => s.targets.map((t) => `${t.device.id}:${t.commands.map((c) => `${c.command}${c.arguments ? `(${c.arguments})` : ""}`).join("+")}`));

test("a sound system is not a light", () => {
  assert.deepEqual(ROOM.map((d) => [d.id, d.kind]).filter(([, k]) => k === "audio"), [["sound", "audio"]]);
  // "All the lights" leaves it alone, and it has its own words.
  const all = homeAction("turn off the lights", ROOM, []);
  assert.ok(all?.kind === "devices");
  assert.ok(!all.targets.some((t) => t.device.id === "sound"));
  const on = homeAction("turn on the sound system", ROOM, []);
  assert.ok(on?.kind === "devices");
  assert.deepEqual(on.targets.map((t) => [t.device.id, t.commands[0].command]), [["sound", "on"]]);
  assert.equal(on.reply, "Turning on sound system.");
  const stop = homeAction("stop the music", ROOM, []);
  assert.ok(stop?.kind === "devices");
  assert.deepEqual(stop.targets.map((t) => [t.device.id, t.commands[0].command]), [["sound", "off"]]);
  // "Music mode" is for the assistant, not a switch of the sound system.
  assert.equal(homeAction("music mode", ROOM, []), null);
});

test("cinema: the top side light dimmed, every other shared light off, the computer desk and the sound system left alone", () => {
  const steps = cinemaShow(ROOM)!;
  // One step, no sweep: the shared lights in the order of the home.
  assert.equal(steps.length, 1);
  assert.deepEqual(flat(steps)[0].sort(), [
    "bedroom:off",
    "couch:off",
    "kitchen:off",
    "side-low:off",
    "side-mid:off",
    "side-top:on+setLevel(15)",
  ]);
  const touched = steps[0].targets.map((t) => t.device.id);
  assert.ok(!touched.includes("desk") && !touched.includes("sound"), "the desk is independent, the sound system is not a light");
  // Another home: its own light left on, at its own level; an unknown one just turns everything off.
  assert.deepEqual(flat(cinemaShow(ROOM, { keep: "kitchen", level: 30 })!)[0].filter((t) => t.startsWith("kitchen")), ["kitchen:on"]);
  assert.ok(flat(cinemaShow(ROOM, { keep: "garage", level: 15 })!)[0].every((t) => t.endsWith(":off")));
  // Another independent light.
  assert.ok(!cinemaShow(ROOM, undefined, ["bedroom"])![0].targets.some((t) => t.device.id === "bedroom"));
  assert.equal(cinemaShow([]), null);
});

test("the computer desk is independent: no mode, and no 'all the lights' prompt, touches it", () => {
  assert.ok(isIndependent(ROOM.find((d) => d.id === "desk")!));
  assert.ok(!sharedLights(ROOM).some((d) => d.id === "desk"));
  assert.ok(!musicShow(ROOM, { lights: ["computer desk", "couch"], off: ["computer desk"], level: 50 })!.some((s) => s.targets.some((t) => t.device.id === "desk")));
  for (const p of ["turn off the lights", "dim the lights to 20 percent", "lights on"]) {
    const a = homeAction(p, ROOM, []);
    assert.ok(a?.kind === "devices", p);
    assert.ok(!a.targets.some((t) => t.device.id === "desk"), p);
    assert.ok(a.targets.some((t) => t.device.id === "bedroom"), p);
  }
  // By its own name it still answers.
  const named = homeAction("turn off the computer desk", ROOM, []);
  assert.ok(named?.kind === "devices");
  assert.deepEqual(named.targets.map((t) => t.device.id), ["desk"]);
  // Nothing independent in another home: every light is shared.
  assert.ok(homeAction("turn off the lights", ROOM, [], [])!.kind === "devices");
  assert.ok((homeAction("turn off the lights", ROOM, [], []) as { targets: { device: StDevice }[] }).targets.some((t) => t.device.id === "desk"));
});

// The side lamp as it reports: three bulbs that take colour and white, Mid and Low off (remembering 70%), Top at cinema's 15%.
const bulb = (id: string, label: string, on: boolean, level: number, hue = 85, saturation = 46, kelvin = 2300): RawDevice => ({
  deviceId: id,
  label,
  type: "VIPER",
  components: [
    {
      id: "main",
      capabilities: status({
        switch: { switch: on ? "on" : "off" },
        switchLevel: { level },
        colorControl: { hue, saturation },
        colorTemperature: { colorTemperature: kelvin },
      }),
    },
  ],
});
const LAMP = [bulb("low", "Side Light Low", false, 70), bulb("mid", "Side Light Mid", false, 70), bulb("top", "Side Light Top", true, 15)]
  .map(toDevice)
  .filter((d): d is StDevice => d !== null);
const cmds = (steps: ShowStep[]) =>
  steps.map((s) => s.targets.map((t) => `${t.device.id}[${t.commands.map((c) => `${c.command}${c.arguments ? JSON.stringify(c.arguments) : ""}`).join(" ")}]`).join(" "));

test("lights report their colour and white", () => {
  const top = LAMP[2];
  assert.deepEqual([top.colour, top.hue, top.saturation, top.colorTemp], [true, 85, 46, 2300]);
  assert.equal(ROOM.find((d) => d.id === "couch")!.colour, undefined);
});

test("the open ripple: slow, from lights that are off, through a cool colour to a warm white, then everything back as it was", () => {
  const r = rippleShow(LAMP, "open")!;
  assert.deepEqual(cmds(r.steps), [
    // The cool wave: on, a soft cool tint, 25%, even for the two that were off (no sensor: a middle 35% for the warm wave).
    'low[on setColor[{"hue":62,"saturation":35}] setLevel[25]]',
    'mid[on setColor[{"hue":62,"saturation":35}] setLevel[25]]',
    'top[on setColor[{"hue":62,"saturation":35}] setLevel[25]]',
    // The warm wave: 2700 K, 35%.
    "low[on setColorTemperature[2700] setLevel[35]]",
    "mid[on setColorTemperature[2700] setLevel[35]]",
    "top[on setColorTemperature[2700] setLevel[35]]",
    // And back: their own white, their own level, on or off last. Low and Mid go dark again, Top stays at 15%.
    "low[setColorTemperature[2300] setLevel[70] off]",
    "mid[setColorTemperature[2300] setLevel[70] off]",
    "top[setColorTemperature[2300] setLevel[15] on]",
  ]);
  assert.deepEqual(r.steps.map((s) => s.after), [500, 500, 250, 400, 400, 400, 300, 300, 0], "slow, with a beat between the waves");
  assert.deepEqual(cmds([r.undo]), [r.steps.slice(6).map((s) => cmds([s])[0]).join(" ")]);
});

test("the ripple's brightness follows the room's light, from the TV's sensor", () => {
  assert.deepEqual([0, 50, 150, 400, 900].map(rippleLevel), [15, 30, 50, 75, 75]);
  assert.equal(rippleLevel(null), 35);
  assert.ok(rippleLevel(25) > rippleLevel(10) && rippleLevel(250) > rippleLevel(100), "brighter room, brighter ripple");
  // The reference home's sensor reads 42 lux: 28% for the warm wave, 20% for the cool one.
  const sensor = DEVICES.find((d) => d.kind === "lightSensor")!;
  const dim = rippleShow([...LAMP, sensor], "open")!;
  assert.deepEqual(dim.steps.map((s) => s.targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0]).slice(0, 6), [20, 20, 20, 28, 28, 28]);
  // Pretending a bright room (a test routine can) lifts it.
  const bright = rippleShow(LAMP, "open", undefined, undefined, 400)!;
  assert.equal(bright.steps[3].targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0], 75);
  // A light that is already on never dims for the wave: it keeps its own level, and only its colour shifts.
  const lit = LAMP.map((d) => (d.id === "top" ? { ...d, on: true, level: 80 } : d));
  const lifted = rippleShow(lit, "open")!;
  assert.equal(lifted.steps[2].targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0], 80);
  assert.equal(lifted.steps[5].targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0], 80);
});

test("the launch ripple is the quick one: warm wave and back, about a second", () => {
  const r = rippleShow(LAMP, "launch")!;
  assert.equal(r.steps.length, 6);
  assert.ok(r.steps.slice(0, 3).every((s) => s.targets[0].commands.some((c) => c.command === "setColorTemperature" && c.arguments![0] === 2700)));
  assert.deepEqual(r.steps.map((s) => s.after), [200, 200, 400, 150, 150, 0]);
  assert.ok(r.steps.reduce((ms, s) => ms + s.after, 0) <= 1100);
});

test("a light showing a colour comes back as that colour, not as white", () => {
  const red = toDevice(bulb("top", "Side Light Top", true, 40, 5, 95, 2300))!;
  assert.deepEqual(restoreCommands(red).map((c) => [c.command, c.arguments]), [
    ["setColor", [{ hue: 5, saturation: 95 }]],
    ["setLevel", [40]],
    ["on", undefined],
  ]);
  // A plain light (no colour, no level) just goes back on or off.
  assert.deepEqual(restoreCommands(ROOM.find((d) => d.id === "kitchen")!).map((c) => c.command), ["off"]);
});

test("the ripple skips lights that are not the side lamp, and the computer desk", () => {
  const r = rippleShow(ROOM, "open")!;
  const touched = new Set(r.steps.flatMap((s) => s.targets.map((t) => t.device.id)));
  assert.deepEqual([...touched].sort(), ["side-low", "side-mid", "side-top"]);
  assert.ok(!["couch", "kitchen", "bedroom", "desk", "sound"].some((id) => touched.has(id)));
  assert.equal(rippleShow([], "open"), null);
  assert.equal(rippleShow(ROOM.filter((d) => !d.name.startsWith("Side Light"))), null);
});

test("a show goes out on schedule, each light's commands in order, and puts the lights back when a step fails", async () => {
  const r = rippleShow(LAMP, "launch")!;
  type Target = ShowStep["targets"][number];

  // Every call takes a different time, longer than the schedule: each light's own order must still hold.
  const log: string[] = [];
  const slept: number[] = [];
  let n = 0;
  const run = runShow(r.steps, {
    send: async (t: Target) => {
      await new Promise((res) => setTimeout(res, (n++ * 7) % 23));
      log.push(t.device.id + ":" + t.commands.map((c) => c.command).join("+"));
    },
    sleep: async (ms) => void slept.push(ms),
  });
  await run.started;
  await run.finished;
  assert.deepEqual(slept, [200, 200, 400, 150, 150], "the schedule, not the network, sets the pace");
  for (const id of ["low", "mid", "top"]) {
    const mine = log.filter((l) => l.startsWith(id + ":"));
    assert.equal(mine.length, 2);
    assert.match(mine[0], /setColorTemperature/, id + ": the wave first");
    assert.ok(mine[1].endsWith("+on") || mine[1].endsWith("+off"), id + ": then back, on or off last");
  }

  // Cancelled after the first step: nothing else goes out.
  let asked = 0;
  const sent: string[] = [];
  const cut = runShow(r.steps, { send: async (t: Target) => void sent.push(t.device.id), sleep: async () => undefined, cancelled: () => ++asked > 1 });
  await cut.finished;
  assert.deepEqual(sent, ["low", "mid"]);

  // A step that fails: the lights are put back (the undo goes out), the error is reported once.
  const goes: string[] = [];
  const errors: unknown[] = [];
  let k = 0;
  const bad = runShow(r.steps, {
    send: async (t: Target) => {
      if (++k === 3) throw new Error("rate limited");
      goes.push(t.device.id + ":" + t.commands.map((c) => c.command).join("+"));
    },
    sleep: async () => undefined,
    undo: r.undo,
    onError: (e) => errors.push(e),
  });
  await bad.finished;
  assert.equal(errors.length, 1);
  // Top was on at 15%: the undo (sent after the rest) leaves it set back, with "on" last, and so for each light.
  const backs = goes.filter((g) => g.endsWith("+on") || g.endsWith("+off"));
  assert.ok(backs.length >= 6, "the way back went out once in the show and once more in the undo");
  assert.ok(goes.at(-1)!.startsWith("top:") && goes.at(-1)!.endsWith("+on"), "the undo is the last thing sent");

  // The first step failing reaches the caller at once.
  const first = runShow(r.steps, { send: async () => Promise.reject(new Error("401")), sleep: async () => undefined });
  await assert.rejects(first.started, /401/);
  await first.finished;
});

test("music: the sound system on, a warm room, the kitchen dark", () => {
  const steps = musicShow(ROOM)!;
  assert.deepEqual(flat(steps), [
    ["sound:on"],
    ["side-low:on+setLevel(50)"],
    ["side-mid:on+setLevel(50)"],
    ["side-top:on+setLevel(50)"],
    ["couch:on"],
    ["kitchen:off"],
  ]);
  assert.equal(musicShow([]), null);
  // Without a sound system the lights still make the room warm.
  assert.equal(flat(musicShow(ROOM.filter((d) => d.kind !== "audio"))!)[0][0], "side-low:on+setLevel(50)");
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

test("the splash ripple swells warm, slowly, then fades in stages to a dim orange-yellow glow that stays", () => {
  const r = rippleShow(LAMP, "splash")!;
  // Three lights warming one after the other, then four fade steps that move all three together.
  assert.equal(r.steps.length, 7);
  assert.ok(r.steps.slice(0, 3).every((s) => s.targets[0].commands.some((c) => c.command === "setColorTemperature" && c.arguments![0] === 2700)));
  assert.ok(!cmds(r.steps).some((s) => s.includes('"saturation":35')), "no cool tint");
  const fade = r.steps.slice(3);
  assert.ok(fade.every((s) => s.targets.length === 3), "the lights fade together");
  assert.ok(fade[0].targets.every((t) => t.commands.some((c) => c.command === "setColor")), "the colour turns in the first step");
  assert.ok(fade.slice(1).every((s) => s.targets.every((t) => !t.commands.some((c) => c.command === "setColor"))));
  const levels = fade.map((s) => s.targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0] as number);
  assert.deepEqual([...levels].sort((a, b) => b - a), levels, "only ever dimmer");
  assert.ok(levels[3] < (r.steps[0].targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0] as number), "ends dimmer than the swell");
  assert.ok(!cmds(r.steps).some((s) => s.includes(" off]")), "nothing is put back off");
  assert.equal(r.steps[6].after, 0);
  assert.ok(r.steps.reduce((ms, st) => ms + st.after, 0) >= 4000, "a long, unhurried splash");
});

test("moodMidpoint eases big hue jumps and leaves small ones alone", () => {
  assert.deepEqual(moodMidpoint([255, 0, 0], [0, 0, 255]), [128, 0, 128]);
  assert.equal(moodMidpoint([255, 0, 0], [255, 40, 0]), null);
  // Red and magenta are close on the colour wheel even though the hue numbers wrap.
  assert.equal(moodMidpoint([255, 0, 10], [250, 0, 60]), null);
});

test("stColour turns sRGB into SmartThings hue and saturation (0-100)", () => {
  assert.deepEqual(stColour([255, 0, 0]), { hue: 0, saturation: 100 });
  assert.deepEqual(stColour([0, 255, 0]), { hue: 33, saturation: 100 });
  assert.deepEqual(stColour([0, 0, 255]), { hue: 67, saturation: 100 });
  assert.deepEqual(stColour([128, 128, 128]), { hue: 0, saturation: 0 });
});

test("the mood show sends colour to lights that have it, in one step, with the lights put back by undo", () => {
  const r = moodShow(LAMP, [30, 70, 200])!;
  assert.equal(r.steps.length, 1);
  const top = r.steps[0].targets.find((t) => t.device.id === "top")!;
  assert.deepEqual(top.commands.find((c) => c.command === "setColor")!.arguments, [{ hue: 63, saturation: 85 }]);
  // The level follows the room; the top light is on at 15% and never dims.
  assert.equal(top.commands.find((c) => c.command === "setLevel")!.arguments![0], 35);
  // A desaturated mood is lifted to a colour that still reads as one.
  const grey = moodShow(LAMP, [120, 125, 130])!;
  assert.equal((grey.steps[0].targets[0].commands.find((c) => c.command === "setColor")!.arguments![0] as { saturation: number }).saturation, 45);
  assert.equal(cmds([r.undo])[0], cmds(rippleShow(LAMP, "open")!.steps.slice(6)).join(" "));
  assert.equal(moodShow([], [30, 70, 200]), null);
});

test("the farewell fades lights that are on to off, together, and leaves the others alone", () => {
  const lit = LAMP.map((d) => (d.id === "low" ? { ...d, on: false } : { ...d, on: true, level: 40 }));
  const steps = fadeShow(lit, 0, undefined, undefined, 3, 700)!;
  assert.equal(steps.length, 3);
  assert.ok(steps.every((s) => s.targets.length === 2), "only the two lit lights");
  const levels = steps.slice(0, 2).map((s) => s.targets[0].commands.find((c) => c.command === "setLevel")!.arguments![0] as number);
  assert.ok(levels[0] <= 40 && levels[1] <= levels[0], "dimmer each step");
  assert.ok(steps[2].targets.every((t) => t.commands.length === 1 && t.commands[0].command === "off"), "the last step switches them off");
  assert.equal(fadeShow(LAMP.map((d) => ({ ...d, on: false })), 0), null, "nothing to fade when all are off");
});

test("dimming for media only lowers: a light under the target keeps its level", () => {
  const lit = LAMP.map((d, i) => ({ ...d, on: true, level: i === 0 ? 10 : 80 }));
  const steps = fadeShow(lit, 15, undefined, undefined, 2, 500)!;
  const last = steps[steps.length - 1];
  const lvl = (id: string) => last.targets.find((t) => t.device.id === id)!.commands.find((c) => c.command === "setLevel")!.arguments![0];
  assert.equal(lvl("low"), 10);
  assert.equal(lvl("mid"), 15);
  assert.ok(!cmds(steps).some((s) => s.includes(" off]")));
});

test("the dance is a chase: one light takes the next colour each beat while the one before eases back", () => {
  const steps = danceShow(LAMP, ["side light low", "side light mid", "side light top"], undefined, 6)!;
  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map((s) => s.targets[0].device.id), ["low", "mid", "top", "low", "mid", "top"]);
  assert.ok(steps.every((s) => s.targets[0].commands.some((c) => c.command === "setColor")));
  assert.notDeepEqual(steps[0].targets[0].commands.find((c) => c.command === "setColor"), steps[1].targets[0].commands.find((c) => c.command === "setColor"));
  assert.ok(steps[1].targets.length === 2 && steps[1].targets[1].device.id === "low", "the previous light eases back");
  assert.ok(steps.every((s) => s.after >= 1000), "a beat cloud calls can keep up with");
  assert.equal(danceShow([], ["side light low"]), null);
});
