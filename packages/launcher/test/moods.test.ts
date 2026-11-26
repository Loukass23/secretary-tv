import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
};

const { MOODS, activeMood, moodRoutines, routineMoods, setActiveMood, toggleMoodRoutine, withMood } = await import("../src/moods.ts");
const { LIGHT_FX_DEFAULT } = await import("../src/light-fx.ts");

test("four moods, each one lights command and the effects it switches", () => {
  assert.deepEqual(MOODS.map((m) => m.key), ["cinema", "music", "dining", "off"]);
  const by = Object.fromEntries(MOODS.map((m) => [m.key, m]));
  // Cinema: dim, and the side lights follow the poster.
  assert.deepEqual(by.cinema.lights, { scene: "cinema" });
  assert.equal(withMood({ ...LIGHT_FX_DEFAULT, sync: false }, by.cinema).sync, true);
  // Music: the dance on.
  assert.equal(withMood({ ...LIGHT_FX_DEFAULT, dance: false }, by.music).dance, true);
  // Dining and Off stop the side lights following; neither touches the splash or the shimmer.
  for (const k of ["dining", "off"]) {
    const fx = withMood({ ...LIGHT_FX_DEFAULT, sync: true, dance: true }, by[k]);
    assert.equal(fx.sync, false);
    assert.equal(fx.dance, false);
    assert.equal(fx.splash, LIGHT_FX_DEFAULT.splash);
    assert.equal(fx.shimmer, LIGHT_FX_DEFAULT.shimmer);
  }
  // Every mood says what it does.
  for (const m of MOODS) assert.ok(m.does.length > 0 && m.hint.length > 0);
});

test("routines shown as moods follow SmartThings' order and leave the effects alone", () => {
  const scenes = [
    { id: "a", name: "Good morning" },
    { id: "b", name: "Reading" },
    { id: "c", name: "Away" },
  ];
  assert.deepEqual(routineMoods(scenes, []), []);
  assert.equal(toggleMoodRoutine("c").join(), "c");
  assert.equal(toggleMoodRoutine("b").join(), "c,b");
  const got = routineMoods(scenes, moodRoutines());
  assert.deepEqual(got.map((m) => m.label), ["Reading", "Away"]);
  assert.deepEqual(got[0].lights, { routine: "b" });
  assert.deepEqual(got[0].fx, {});
  assert.equal(toggleMoodRoutine("c").join(), "b", "shown again: hidden");
});

test("the active mood is kept until another is set", () => {
  assert.equal(activeMood(), null);
  setActiveMood("music");
  assert.equal(activeMood(), "music");
  setActiveMood(null);
  assert.equal(activeMood(), null);
});

test("a routine's part with a film: one routine each for Play and after, taken from any other", async () => {
  const { withPart } = await import("../src/moods.ts");
  assert.deepEqual(withPart({}, "a", "movie"), { movie: "a", restore: undefined });
  assert.deepEqual(withPart({ movie: "a" }, "b", "movie"), { movie: "b", restore: undefined });
  assert.deepEqual(withPart({ movie: "a", restore: "b" }, "a", "restore"), { movie: undefined, restore: "a" });
  assert.deepEqual(withPart({ movie: "a", restore: "b" }, "b", "none"), { movie: "a", restore: undefined });
});
