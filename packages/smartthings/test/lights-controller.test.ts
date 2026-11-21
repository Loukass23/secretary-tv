import { test } from "node:test";
import assert from "node:assert/strict";
import { createLights, MOOD_SETTLE_MS, MOOD_STEP_MS, moodMs, type StDevice } from "../src/index.ts";

const light = (id: string, name: string, over: Partial<StDevice> = {}): StDevice => ({ id, name, kind: "light", local: false, dimmable: true, colour: true, on: true, level: 60, ...over }) as StDevice;
const sensor = (lux: number): StDevice => ({ id: "s", name: "TV", kind: "lightSensor", local: false, dimmable: false, lux }) as StDevice;
const SIDE = [light("low", "Side light low"), light("mid", "Side light mid"), light("top", "Side light top")];

function setup(devices: StDevice[], fx = { enabled: true, splash: true, sync: true }) {
  const sent: { id: string; cmds: string }[] = [];
  const ctl = createLights({
    home: {
      devices: async () => devices,
      command: async (id: string, commands: { command: string; arguments?: unknown[] }[]) => void sent.push({ id, cmds: commands.map((c) => `${c.command}${c.arguments ? JSON.stringify(c.arguments) : ""}`).join(" ") }),
    } as never,
    configured: () => true,
    fx: () => fx,
    warn: () => {},
  });
  return { ctl, sent };
}

test("playback: off at the start, soft on a pause, off on resume, and put back as it was at the end", async () => {
  const { ctl, sent } = setup(SIDE);
  await ctl.playbackOff(5_000);
  assert.ok(sent.some((s) => s.cmds === "off"), "every light ends off");
  sent.length = 0;
  await ctl.playbackPause();
  assert.equal(sent.length, 3);
  assert.ok(sent.every((s) => s.cmds.startsWith("on") && s.cmds.includes("setLevel[15]")), "back at the cinema level");
  sent.length = 0;
  await ctl.playbackResume();
  assert.deepEqual(sent.map((s) => s.cmds), ["off", "off", "off"]);
  sent.length = 0;
  await ctl.playbackStop();
  assert.equal(sent.length, 3);
  assert.ok(sent.every((s) => s.cmds.endsWith("setLevel[60] on")), "level and on, as they were");
});

test("a pause or resume does nothing when playback never took the lights, or the effects are off", async () => {
  const a = setup(SIDE);
  await a.ctl.playbackPause();
  await a.ctl.playbackResume();
  assert.equal(a.sent.length, 0);
  const b = setup(SIDE, { enabled: false, splash: false, sync: false });
  await b.ctl.playbackOff();
  assert.equal(b.sent.length, 0);
});

test("the splash's glow stays in a dark room and fades out when the TV's sensor reads 150 lux or more", async () => {
  const dark = setup([...SIDE, sensor(30)]);
  const bright = setup([...SIDE, sensor(300)]);
  await Promise.all([dark.ctl.playRipple("splash"), bright.ctl.playRipple("splash")]);
  assert.ok(!dark.sent.some((s) => s.cmds.endsWith("off")), "the glow is left");
  assert.ok(bright.sent.some((s) => s.cmds === "off"), "the lights go off");
});

test("browsing fast sends only the colour focus rests on, as a glide of small steps, and goes back when focus leaves", async () => {
  const { ctl, sent } = setup(SIDE);
  ctl.syncMood([200, 30, 30]);
  await new Promise((r) => setTimeout(r, 150));
  ctl.syncMood([30, 200, 60]);
  await new Promise((r) => setTimeout(r, 150));
  ctl.syncMood([30, 60, 220]);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sent.length, 0, "nothing goes out while focus keeps moving");
  await new Promise((r) => setTimeout(r, 3_000));
  const hues = sent.filter((s) => s.id === "low").map((s) => /"hue":(\d+)/.exec(s.cmds)?.[1]).filter(Boolean).map(Number);
  assert.equal(hues.length, 3, `a glide of three moves, not one jump (${hues})`);
  assert.ok(Math.abs(hues[hues.length - 1] - 65) < 4, `it ends on the last colour (${hues})`);
  const n = sent.length;
  ctl.syncMood(null);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(sent.length > n, "the way back was sent");
});

test("a newer colour replaces a glide still playing instead of waiting for it", async () => {
  const { ctl, sent } = setup(SIDE);
  ctl.syncMood([200, 30, 30]);
  await new Promise((r) => setTimeout(r, 1_000));
  const before = sent.length;
  ctl.syncMood([30, 60, 220]);
  await new Promise((r) => setTimeout(r, 1_000));
  assert.ok(sent.length > before, "the new glide began while the old one was still playing");
});

test("the colour timings come from the environment when they are sane, else the defaults", () => {
  assert.equal(moodMs("800", MOOD_STEP_MS, 100, 5_000), 800);
  assert.equal(moodMs("", MOOD_STEP_MS, 100, 5_000), MOOD_STEP_MS);
  assert.equal(moodMs("fast", MOOD_STEP_MS, 100, 5_000), MOOD_STEP_MS);
  assert.equal(moodMs("20", MOOD_STEP_MS, 100, 5_000), MOOD_STEP_MS, "under the least is ignored");
  assert.equal(moodMs("0", MOOD_SETTLE_MS, 0, 10_000), 0, "no wait is allowed for the rest time");
  assert.equal(moodMs(undefined, MOOD_SETTLE_MS, 0, 10_000), MOOD_SETTLE_MS);
});
