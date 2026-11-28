import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPicture, parsePictureSet, readTvPicture, setTvPicture, type TvSettings } from "../src/picture-mode.ts";

/** The reference TV's settings API, as probed (docs/smartthings.md): each name listed per kind of source. */
function fakeTv(start = 65536) {
  let value = start;
  const list = [
    { osdName: "Dynamic", value: 327692 },
    { osdName: "Eco", value: 327707 },
    { osdName: "Dynamic", value: 65536 },
    { osdName: "Standard", value: 65537 },
    { osdName: "FILMMAKER MODE", value: 655360 },
    { osdName: "Eco", value: 65552 },
  ];
  const sets: string[] = [];
  const s: TvSettings = {
    getItemValue: (id) => (id === "picturemode" ? list.find((e) => e.value === value) ?? null : null),
    getItemDataList: () => list,
    setItemValue: (_id, v) => {
      sets.push(v);
      value = Number(v);
      return true;
    },
  };
  return { s, sets, remote: (v: number) => void (value = v) };
}

test("the TV's own reading, and setting a mode picks the entry for the current kind of source", () => {
  const tv = fakeTv();
  assert.equal(readTvPicture(tv.s), "Dynamic");
  assert.equal(setTvPicture("eco", tv.s), true);
  assert.deepEqual(tv.sets, ["65552"], "the TV apps' Eco, not the other source's");
  assert.equal(readTvPicture(tv.s), "Eco");
  // The remote changes it: the next read follows.
  tv.remote(65537);
  assert.equal(readTvPicture(tv.s), "Standard");
  assert.equal(setTvPicture("Vivid", tv.s), false, "a mode the TV does not list");
  assert.equal(readTvPicture(null), undefined);
  assert.equal(setTvPicture("Eco", null), false);
  const broken: TvSettings = {
    getItemValue: () => {
      throw new Error("Failed to get item value");
    },
    getItemDataList: () => null,
    setItemValue: () => false,
  };
  assert.equal(readTvPicture(broken), undefined);
  assert.equal(setTvPicture("Eco", broken), false);
});

test("which mode to trust: the TV's reading, else the newer of SmartThings' report and Secretary's last set", () => {
  const last = { mode: "Eco", at: 2_000 };
  assert.equal(currentPicture("Standard", last, { mode: "Dynamic", at: 9_000 }), "Standard");
  assert.equal(currentPicture(undefined, last, { mode: "Dynamic", at: 1_000 }), "Eco", "SmartThings' report is older");
  assert.equal(currentPicture(undefined, last, { mode: "Dynamic", at: 3_000 }), "Dynamic", "the remote changed it since");
  assert.equal(currentPicture(undefined, last, { mode: "Dynamic" }), "Eco", "no time on the report");
  assert.equal(currentPicture(undefined, undefined, { mode: "Dynamic", at: 1 }), "Dynamic");
  assert.equal(currentPicture(undefined, last, undefined), "Eco");
  assert.equal(currentPicture(undefined, undefined, undefined), undefined);
});

test("the last set reads both the old plain name and the timed JSON", () => {
  assert.deepEqual(parsePictureSet("Eco"), { mode: "Eco", at: 0 });
  assert.deepEqual(parsePictureSet('{"mode":"Dynamic","at":5}'), { mode: "Dynamic", at: 5 });
  assert.equal(parsePictureSet(null), undefined);
  assert.equal(parsePictureSet("{broken"), undefined);
});
