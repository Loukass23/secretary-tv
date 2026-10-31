import { test } from "node:test";
import assert from "node:assert/strict";
import type { Stream } from "../src/lib/streams.ts";
import { focusable, sheetRows } from "../src/ui/sheet.ts";

const s = (title: string, extra: Partial<Stream> = {}): Stream => ({ name: title, title, url: `https://x.example/${title}`, ...extra });

test("grouped: best first, then sections by quality with counts, largest first, unknown and low last", () => {
  const list = [
    s("A.1080p 4 GB"),
    s("B.2160p.HDR 22 GB"),
    s("C.2160p 14 GB"),
    s("D.1080p.HDR 9 GB"),
    s("E.1080p"),
    s("F.1080p 12 GB"),
    s("G.720p 1 GB"),
    s("H.2160p.HDR 40 GB"),
    s("I.1080p 30 GB"),
    s("Configure this addon", { notice: true }),
  ];
  const items = sheetRows(list, { best: list[1], isLow: (x) => x === list[8] });
  const lines = items.map((it) => (it.kind === "header" ? `# ${it.label}` : it.stream.title.split(" ")[0]));
  assert.deepEqual(lines, [
    "# Best for this TV",
    "B.2160p.HDR",
    "# 4K HDR · 1",
    "H.2160p.HDR",
    "# 4K · 1",
    "C.2160p",
    "# 1080p HDR · 1",
    "D.1080p.HDR",
    "# 1080p · 4",
    "F.1080p",
    "A.1080p",
    "E.1080p",
    "I.1080p",
    "# 720p · 1",
    "G.720p",
    "# Other · 1",
    "Configure",
  ]);
  assert.deepEqual(focusable(items).map((i) => items[i].kind), Array(10).fill("row"));
});

test("provider order: the list as it is, no headers", () => {
  const list = [s("A.1080p"), s("B.2160p")];
  const items = sheetRows(list, { best: list[1], order: "provider" });
  assert.deepEqual(items.map((it) => it.kind === "row" && [it.stream.title, it.best]), [["A.1080p", false], ["B.2160p", true]]);
});

test("filters: chips for the list, what they keep, and how many they hide", async () => {
  const { applyFilters, filterChips, filterLabel } = await import("../src/ui/sheet.ts");
  const { audioLanguages } = await import("../src/lib/sourcepref.ts");
  const list = [
    s("A.2160p.HDR.mkv • 🇬🇧 EN"),
    s("B.1080p.mp4 • 🇫🇷/🇬🇧 MULTI", { name: "⚡ [PM] 1080p" }),
    s("C.1080p.mkv • 🇫🇷 VFF"),
    s("D.720p.mp4 • 🇬🇧 EN", { url: "debrid:tb:abc" }),
  ];
  const chips = filterChips(list, audioLanguages);
  assert.deepEqual(chips.map(filterLabel), ["HDR off", "MP4 only", "Cached only", "Audio EN", "Audio FR", "Audio Multi"]);
  const titles = (on: string[]) => applyFilters(list, new Set(on as never), audioLanguages).kept.map((x) => x.title[0]);
  assert.deepEqual(titles(["no-hdr"]), ["B", "C", "D"]);
  assert.deepEqual(titles(["mp4"]), ["B", "D"]);
  assert.deepEqual(titles(["cached"]), ["B", "D"]);
  assert.deepEqual(titles(["audio:fr"]), ["B", "C"]);
  assert.deepEqual(titles(["mp4", "audio:fr"]), ["B"]);
  assert.equal(applyFilters(list, new Set(["mp4"] as never), audioLanguages).hidden, 2);
});
