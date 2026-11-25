import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  onSettings,
  saveSettings,
  SETTING_ITEMS,
  SETTING_TAB_BLURB,
  SETTING_TABS,
  toggleApp,
} from "../src/lib/settings.ts";
import { rowWindow, SETTINGS_START, type SettingsPlace, type SettingsShape, stepSettings } from "../src/ui/settings-nav.ts";

test("settings migration: a v1 file from before the home section keeps every value and gets the home defaults", () => {
  const old = {
    general: { bootAnimation: "fade", clockFormat: "12h", accentTheme: "blue" },
    domotics: { cinemaAutoDim: true, moodBackground: false },
    playback: { resumeAtOnce: false, autoSkip: true, spoilerProtection: true, audioLangs: ["fr"] },
  };
  const s = mergeSettings(old as never);
  assert.equal(s.general.clockFormat, "12h");
  assert.equal(s.general.accentTheme, "blue");
  assert.equal(s.domotics.cinemaAutoDim, true);
  assert.equal(s.domotics.moodBackground, false);
  assert.equal(s.playback.resumeAtOnce, false);
  assert.equal(s.playback.autoSkip, true);
  assert.equal(s.playback.spoilerProtection, "blur");
  assert.deepEqual(s.playback.audioLangs, ["fr"]);
  assert.deepEqual(s.home, DEFAULT_SETTINGS.home);
});

test("settings migration: the old nest.speak key keeps the spoken replies muted until the setting is saved", () => {
  assert.equal(mergeSettings(null, { speak: "0" }).home.spokenReplies, false);
  assert.equal(mergeSettings({ playback: {} } as never, { speak: "0" }).home.spokenReplies, false);
  assert.equal(mergeSettings(null, { speak: "1" }).home.spokenReplies, true);
  assert.equal(mergeSettings(null, { speak: null }).home.spokenReplies, true);
  // Once saved, the setting wins over the old key.
  assert.equal(mergeSettings({ home: { spokenReplies: true } } as never, { speak: "0" }).home.spokenReplies, true);
});

test("settings migration: wrong types fall back per field, and hidden apps keep only distinct ids", () => {
  const s = mergeSettings({ home: { reminders: "no", homeAlerts: false, listenOnFocus: 0, hiddenApps: ["a", 3, "", "a", "b"] } } as never);
  assert.equal(s.home.reminders, true);
  assert.equal(s.home.homeAlerts, false);
  assert.equal(s.home.listenOnFocus, true);
  assert.deepEqual(s.home.hiddenApps, ["a", "b"]);
  assert.deepEqual(mergeSettings({ home: "broken" } as never).home, DEFAULT_SETTINGS.home);
});

test("settings: spoiler protection is Off by default and its line, under Watching, cycles Off, Blur and Hide", () => {
  assert.equal(DEFAULT_SETTINGS.playback.spoilerProtection, "off");
  const item = SETTING_ITEMS.find((i) => i.id === "playback.spoilerProtection");
  assert.ok(item);
  assert.equal(item.section, "Watching");
  assert.equal(item.getValue(DEFAULT_SETTINGS), "Off");
  const blur = item.cycle(DEFAULT_SETTINGS, 1);
  assert.equal(blur.playback.spoilerProtection, "blur");
  assert.equal(item.getValue(blur), "Blur");
  const hide = item.cycle(blur, 1);
  assert.equal(item.getValue(hide), "Hide");
  assert.equal(item.cycle(hide, 1).playback.spoilerProtection, "off");
  assert.equal(item.cycle(DEFAULT_SETTINGS, -1).playback.spoilerProtection, "hide");
});

test("settings: every line is under a tab, ids are unique, and each tab says what it holds", () => {
  const ids = SETTING_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const it of SETTING_ITEMS) assert.ok(SETTING_TABS.includes(it.section), it.id);
  for (const tab of SETTING_TABS) assert.ok(SETTING_TAB_BLURB[tab].length > 0, tab);
  // Lines of one tab sit together, in the tabs' order.
  const order = SETTING_ITEMS.map((i) => i.section).filter((t, k, all) => all.indexOf(t) === k);
  assert.deepEqual(order, SETTING_TABS.filter((t) => order.includes(t)));
});

test("settings: Home screen has a switch for each feature, and each flips its own field only", () => {
  for (const f of ["reminders", "homeAlerts", "spokenReplies", "listenOnFocus"] as const) {
    const item = SETTING_ITEMS.find((i) => i.id === `home.${f}`);
    assert.ok(item, f);
    assert.equal(item.section, "Home screen");
    const next = item.cycle(DEFAULT_SETTINGS, 1);
    assert.equal(next.home[f], !DEFAULT_SETTINGS.home[f]);
    assert.deepEqual({ ...next.home, [f]: DEFAULT_SETTINGS.home[f] }, DEFAULT_SETTINGS.home);
  }
});

test("settings: an app is hidden and shown again; saving tells Secretary", () => {
  const hidden = toggleApp(DEFAULT_SETTINGS, "app.guide");
  assert.deepEqual(hidden.home.hiddenApps, ["app.guide"]);
  assert.deepEqual(toggleApp(hidden, "app.guide").home.hiddenApps, []);
  assert.deepEqual(DEFAULT_SETTINGS.home.hiddenApps, []);
  const seen: string[][] = [];
  const stop = onSettings((s) => seen.push(s.home.hiddenApps));
  saveSettings(hidden);
  stop();
  saveSettings(DEFAULT_SETTINGS);
  assert.deepEqual(seen, [["app.guide"]]);
});

const shape: SettingsShape = { tabs: 6, rows: 4, header: { person: true, buttons: 7 } };
const go = (p: SettingsPlace, key: string, s = shape) => {
  const r = stepSettings(p, key, s);
  assert.notEqual(r, "close");
  return r as SettingsPlace;
};

test("settings nav: Left and Right go through the tabs, Down into the lines and Up back out to the header", () => {
  let p = SETTINGS_START;
  assert.equal(p.tab, 0);
  assert.equal(go(p, "Left"), p);
  p = go(p, "Right");
  assert.equal(p.tab, 1);
  p = go(p, "Down");
  assert.deepEqual(p.focus, { area: "list", i: 0 });
  p = go(p, "Down");
  assert.deepEqual(p.focus, { area: "list", i: 1 });
  // On a line, Left and Right are the line's own.
  assert.equal(go(p, "Right"), p);
  p = go(go(p, "Up"), "Up");
  assert.deepEqual(p.focus, { area: "tabs" });
  p = go(p, "Up");
  assert.deepEqual(p.focus, { area: "head", at: "person" });
  p = go(p, "Right");
  assert.deepEqual(p.focus, { area: "head", at: 0 });
  // Back in the header leaves it; Back elsewhere closes Settings.
  p = go(p, "Back");
  assert.deepEqual(p, { focus: { area: "tabs" }, tab: 1 });
  assert.equal(stepSettings(p, "Back", shape), "close");
});

test("settings nav: without a header Up stays on the tabs, an empty tab keeps Down there, the ends stop", () => {
  assert.equal(go(SETTINGS_START, "Up", { ...shape, header: null }), SETTINGS_START);
  assert.equal(go(SETTINGS_START, "Down", { ...shape, rows: 0 }), SETTINGS_START);
  const last: SettingsPlace = { focus: { area: "list", i: 3 }, tab: 0 };
  assert.equal(go(last, "Down"), last);
  const end: SettingsPlace = { ...SETTINGS_START, tab: 5 };
  assert.equal(go(end, "Right"), end);
});

test("settings: a long category draws only the lines around focus", () => {
  assert.deepEqual(rowWindow(0, 40), { from: 0, to: 10 });
  assert.deepEqual(rowWindow(20, 40), { from: 17, to: 27 });
  assert.deepEqual(rowWindow(39, 40), { from: 36, to: 40 });
  assert.deepEqual(rowWindow(0, 3), { from: 0, to: 3 });
});
