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

test("saved moods over the defaults: a field left out keeps the default's, null leaves that part as it is", async () => {
  const { mergeMoods, parseMoodEdits } = await import("../src/moods.ts");
  const edits = parseMoodEdits({
    cinema: { lights: { scene: "off" }, fx: { sync: false, splash: true }, picture: "Eco", sound: true },
    music: { picture: null, sound: null },
    dining: { lights: { keep: true } },
    // Unreadable fields are dropped one by one, an unreadable mood entirely.
    off: { lights: { scene: "disco" }, fx: { sync: "yes" }, picture: 3 },
    junk: "nope",
  });
  assert.deepEqual(Object.keys(edits).sort(), ["cinema", "dining", "music", "off"]);
  const by = Object.fromEntries(mergeMoods(MOODS, edits).map((m) => [m.key, m]));
  assert.deepEqual(by.cinema.lights, { scene: "off" });
  assert.deepEqual(by.cinema.fx, { sync: false, splash: true }, "the saved switches replace the default's set");
  assert.equal(by.cinema.picture, "Eco");
  assert.equal(by.cinema.sound, true);
  assert.ok(by.cinema.edited);
  assert.ok(by.cinema.does.includes("The picture goes to Eco"));
  // Music keeps its lights and switches, and leaves picture and sound alone.
  assert.deepEqual(by.music.lights, { scene: "music" });
  assert.deepEqual(by.music.fx, MOODS[1].fx);
  assert.equal("picture" in by.music, false);
  assert.equal("sound" in by.music, false);
  assert.deepEqual(by.dining.lights, { keep: true });
  // Off kept only its valid parts: none for lights or picture, an empty set of switches.
  assert.deepEqual(by.off.lights, { scene: "off" });
  assert.deepEqual(by.off.fx, {});
  assert.equal(by.off.picture, undefined);
  // An unedited mood is the default, untouched, with its own words.
  const plain = mergeMoods(MOODS, {});
  assert.deepEqual(plain, [...MOODS]);
});

test("editing a mood saves only the change, and putting it back restores the default", async () => {
  const { allMoods, editMood, resetMood, MOODS_KEY } = await import("../src/moods.ts");
  store.delete(MOODS_KEY);
  editMood("dining", { picture: "Eco" });
  editMood("dining", { sound: false });
  assert.deepEqual(JSON.parse(store.get(MOODS_KEY)!), { dining: { picture: "Eco", sound: false } });
  const dining = allMoods([]).find((m) => m.key === "dining")!;
  assert.equal(dining.picture, "Eco");
  assert.equal(dining.sound, false);
  assert.deepEqual(dining.lights, { scene: "warm" });
  resetMood("dining");
  assert.deepEqual(allMoods([]).find((m) => m.key === "dining"), MOODS[2]);
  // A routine's mood takes changes too, by its key.
  const scenes = [{ id: "r1", name: "Reading" }];
  store.set("nest.moodRoutines", JSON.stringify(["r1"]));
  editMood("routine:r1", { fx: { dance: false } });
  const r = allMoods(scenes).find((m) => m.key === "routine:r1")!;
  assert.deepEqual(r.lights, { routine: "r1" });
  assert.deepEqual(r.fx, { dance: false });
  assert.ok(r.does[0].includes("Reading"));
  store.delete(MOODS_KEY);
  store.delete("nest.moodRoutines");
});

test("the editor's steps wrap, and the choices list the TV's modes once", async () => {
  const { cycle, SWITCH_STEPS, lightsChoices, pictureChoices, moodIcon, moodStage } = await import("../src/moods.ts");
  assert.equal(cycle(SWITCH_STEPS, 0, 1), false);
  assert.equal(cycle(SWITCH_STEPS, 2, 1), true);
  assert.equal(cycle(SWITCH_STEPS, -1, 1), true, "from nowhere: the first");
  assert.equal(cycle(SWITCH_STEPS, 0, -1), undefined);
  assert.deepEqual(lightsChoices([{ id: "a" }]).at(-2), { routine: "a" });
  assert.deepEqual(lightsChoices([]).at(-1), { keep: true });
  assert.deepEqual(pictureChoices(["Dynamic", "Eco"], ["Dynamic", "Eco", "Movie", "movie"]), [undefined, "Dynamic", "Eco", "Movie"]);
  assert.equal(moodIcon(null), "lights");
  assert.equal(moodIcon("cinema"), "cinema");
  assert.equal(moodIcon("routine:x"), "routine");
  assert.equal(moodStage(MOODS[0]).split(" ").sort().join(), "is-dim,is-on,is-sync");
  assert.equal(moodStage(MOODS[3]), "");
});
