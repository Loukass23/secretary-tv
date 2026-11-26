import { test } from "node:test";
import assert from "node:assert/strict";
import { type MenuPage, startMenu, stepMenu, windowRows } from "../src/lib/playermenu.ts";
import { audioTracks, preferredAudio } from "../src/player/tracks.ts";

const pages: Record<string, MenuPage> = {
  top: { id: "top", title: "Options", rows: [{ id: "audio", label: "Audio", go: "audio" }, { id: "aspect", label: "Picture", cycles: true }, { id: "info", label: "Info", go: "info" }] },
  audio: { id: "audio", title: "Audio", rows: [{ id: "1", label: "English" }, { id: "2", label: "French", checked: true }] },
  info: { id: "info", title: "Info", rows: [] },
};
const pageOf = (id: string) => pages[id];

test("Up and Down stop at the ends; Enter opens a page on the row in use; Back returns to the row that opened it", () => {
  let s = startMenu();
  s = stepMenu(s, "Up", pageOf).state;
  assert.equal(s.row, 0);
  s = stepMenu(s, "Down", pageOf).state;
  s = stepMenu(s, "Down", pageOf).state;
  s = stepMenu(s, "Down", pageOf).state;
  assert.equal(s.row, 2);
  s = stepMenu({ stack: ["top"], row: 0 }, "Enter", pageOf).state;
  assert.deepEqual(s, { stack: ["top", "audio"], row: 1 });
  const back = stepMenu(s, "Back", pageOf);
  assert.deepEqual(back.state, { stack: ["top"], row: 0 });
  assert.equal(stepMenu(back.state, "Back", pageOf).close, true);
});

test("Enter chooses a row; Left and Right only cycle a row that cycles", () => {
  const choose = stepMenu({ stack: ["audio", "audio"].slice(1), row: 0 }, "Enter", pageOf);
  assert.equal(choose.pick?.row.id, "1");
  assert.equal(stepMenu({ stack: ["top"], row: 0 }, "Right", pageOf).pick, undefined);
  assert.equal(stepMenu({ stack: ["top"], row: 1 }, "Left", pageOf).pick?.dir, -1);
  assert.equal(stepMenu({ stack: ["top"], row: 1 }, "Enter", pageOf).pick?.dir, 1);
});

test("windowRows keeps the focused row inside a short window", () => {
  const rows = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(windowRows(rows, 0, 8), { from: 0, rows: rows.slice(0, 8) });
  assert.equal(windowRows(rows, 19, 8).from, 12);
  assert.equal(windowRows(rows, 10, 8).rows.includes(10), true);
  assert.deepEqual(windowRows([1, 2], 1, 8), { from: 0, rows: [1, 2] });
});

test("audio tracks are named from the file, and a language list picks one", () => {
  const t = audioTracks([
    { index: 0, type: "VIDEO", extra_info: "{}" },
    { index: 1, type: "AUDIO", extra_info: JSON.stringify({ language: "jpn", fourCC: "ac3", channels: "6" }) },
    { index: 2, type: "AUDIO", extra_info: JSON.stringify({ Language: "eng", fourCC: "mp4a", channels: "2" }) },
    { index: 3, type: "AUDIO", extra_info: "{}" },
  ]);
  assert.deepEqual(t.map((x) => x.label), ["Japanese · AC3 5.1", "English · AAC stereo", "Track 3"]);
  assert.equal(preferredAudio(t, ["fr", "en"])?.index, 2);
  assert.equal(preferredAudio(t, ["fr"]), null);
});
