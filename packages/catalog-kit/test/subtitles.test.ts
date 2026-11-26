import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanCue, cueAt, delayLabel, groupSubtitles, loadCues, parseCues } from "../src/lib/subtitles.ts";

const SRT = "﻿1\r\n00:00:05,000 --> 00:00:07,500\r\n<i>Hello</i> &amp; {\\an8}welcome\r\n\r\n2\r\n00:01:10,250 --> 00:01:12,000\r\nSecond\r\nline\r\n\r\nnot a cue\r\n";
const VTT = "WEBVTT\n\n00:05.000 --> 00:07.000 line:90%\nShort form\n\n1:00:00.000 --> 1:00:02.000\nOne hour in\n";

test("SubRip and WebVTT are read, with markup removed and a broken block skipped", () => {
  const a = parseCues(SRT);
  assert.deepEqual(a, [
    { start: 5, end: 7.5, text: "Hello & welcome" },
    { start: 70.25, end: 72, text: "Second\nline" },
  ]);
  const v = parseCues(VTT);
  assert.deepEqual(v.map((c) => [c.start, c.end, c.text]), [[5, 7, "Short form"], [3600, 3602, "One hour in"]]);
  assert.equal(cleanCue("<b>x</b>&nbsp;y"), "x y");
});

test("cueAt finds the cue for a position, and none between cues", () => {
  const cues = parseCues(SRT);
  assert.equal(cueAt(cues, 4.9), -1);
  assert.equal(cueAt(cues, 5), 0);
  assert.equal(cueAt(cues, 7.5), -1);
  assert.equal(cueAt(cues, 71), 1);
  assert.equal(cueAt(cues, 500), -1);
  // A long cue that a later one overlaps still shows.
  const overlap = [{ start: 0, end: 10, text: "a" }, { start: 2, end: 3, text: "b" }];
  assert.equal(cueAt(overlap, 5), 0);
});

test("loadCues rejects an empty or failing file", async () => {
  const ok = async () => new Response(SRT);
  assert.equal((await loadCues("http://x/a.srt", ok as typeof fetch)).length, 2);
  await assert.rejects(loadCues("http://x/a.srt", (async () => new Response("nothing")) as typeof fetch));
  await assert.rejects(loadCues("http://x/a.srt", (async () => new Response("", { status: 404 })) as typeof fetch));
});

test("subtitles group by language, the preferred ones first", () => {
  const s = (id: string, lang: string) => ({ id, url: `http://x/${id}`, lang, addon: "A" });
  const groups = groupSubtitles([s("1", "ger"), s("2", "eng"), s("3", "fre"), s("4", "eng"), s("5", "und")], ["fr"]);
  assert.deepEqual(groups.map((g) => [g.label, g.subs.length]), [["French", 1], ["English", 2], ["German", 1], ["Unknown", 1]]);
  assert.equal(delayLabel(0), "In sync");
  assert.equal(delayLabel(-1.5), "−1.5 s");
});
