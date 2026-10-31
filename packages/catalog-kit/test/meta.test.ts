import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCaps } from "@secretary/core";
import { decide } from "../src/lib/autoplay.ts";
import { probeCaps } from "../src/lib/device.ts";
import { langRank, rankSources } from "../src/lib/rules.ts";
import { audioLangsOf, DEFAULT_SETTINGS, langPref, mergeSettings, SETTING_ITEMS, subLangsOf, systemLang } from "../src/lib/settings.ts";
import { parseStreamInfo, type Stream } from "../src/lib/streams.ts";
import { applyFilters, filterChips, sourceLanguages } from "../src/ui/sheet.ts";

const s = (title: string, meta?: Stream["meta"]): Stream => ({ name: title, title, url: `https://x.example/${title}`, ...(meta ? { meta } : {}) });
const meta = (m: Partial<NonNullable<Stream["meta"]>> = {}): NonNullable<Stream["meta"]> => ({ verified: false, trusted: false, ...m });

test("parseStreamInfo: a provider's _meta wins field by field, the text fills the rest", () => {
  const text = "Film.1080p.HDR.x264.AAC 4.2 GB";
  assert.deepEqual(parseStreamInfo(s(text, meta({ resolution: 2160, codec: "hevc", dv: true, audio: "atmos", sizeBytes: 12.5 * 1024 ** 3 }))), {
    ...parseStreamInfo(s(text)),
    resolution: "4K",
    hdr: "DV",
    codec: "HEVC",
    audio: "ATMOS",
    size: "12.5 GB",
    badges: ["4K", "DV", "HEVC", "ATMOS"],
  });
  // hdr: false says there is none, whatever the text reads; a field it leaves out comes from the text.
  const flat = parseStreamInfo(s(text, meta({ hdr: false, resolution: "1080p" })));
  assert.equal(flat.hdr, undefined);
  assert.equal(flat.codec, "AVC");
  assert.equal(flat.size, "4.2 GB");
  assert.equal(parseStreamInfo(s("Film", meta({ hdr: "hdr10+" }))).hdr, "HDR10+");
  assert.equal(parseStreamInfo(s("Film", meta({ hdr: true }))).hdr, "HDR10");
  // No _meta: the text alone, as always.
  assert.deepEqual(parseStreamInfo(s(text)).badges, ["1080p", "HDR10", "AVC", "AAC"]);
});

test("rankSources: verified, then the viewer's languages from _meta, before size and resolution", () => {
  const langs = { audio: ["fr", "en"], subs: ["fr"] };
  const list = [
    s("A.2160p", meta({ langs: { audio: ["ja"], subs: [], multi: false } })),
    s("B.1080p", meta({ langs: { audio: ["en"], subs: [], multi: false } })),
    s("C.720p", meta({ langs: { audio: ["ja"], subs: ["fr"], multi: false } })),
    s("D.2160p"),
    s("E.720p", meta({ verified: true, langs: { audio: ["ja"], subs: [], multi: false } })),
    s("F.1080p", meta({ langs: { audio: ["fr", "en"], subs: [], multi: true } })),
  ];
  assert.deepEqual(rankSources(list, { langs }).map((x) => x.title[0]), ["E", "F", "B", "C", "D", "A"]);
  // Without the language setting: verified first, then resolution, as before.
  assert.deepEqual(rankSources(list).map((x) => x.title[0]), ["E", "A", "D", "B", "F", "C"]);
  assert.equal(langRank(s("X"), langs), 3);
  assert.equal(langRank(s("X"), { audio: [], subs: [] }), 0);
});

test("rankSources and autoplay: a codec outside the TV's caps ranks as no resolution", () => {
  const list = [s("A.2160p.AV1"), s("B.1080p.x265"), s("C.720p")];
  assert.deepEqual(rankSources(list).map((x) => x.title[0]), ["B", "C", "A"]);
  assert.deepEqual(rankSources(list, { caps: parseCaps("av1") }).map((x) => x.title[0]), ["A", "C", "B"]);
  const early = (caps?: string) =>
    decide({ candidates: [s("A.2160p.AV1")], status: [], done: false, elapsedMs: 0, waitMs: 5000, rules: caps ? { caps: parseCaps(caps) } : {} });
  assert.ok("wait" in early());
  assert.ok("go" in early("hevc,av1"));
});

test("sheet: a Verified chip when some sources are, audio chips from _meta.langs", () => {
  const list = [
    s("A.1080p", meta({ verified: true, langs: { audio: ["es"], subs: [], multi: false } })),
    s("B.1080p.FRENCH", meta({ langs: { audio: ["es", "fr"], subs: [], multi: true } })),
    s("C.1080p.FRENCH"),
  ];
  assert.deepEqual(sourceLanguages(list[0]), ["es"]);
  assert.deepEqual(sourceLanguages(list[1]), ["es", "fr", "multi"]);
  assert.deepEqual(sourceLanguages(list[2]), ["fr"]);
  // A provider's _meta that names no language: the text is read instead.
  assert.deepEqual(sourceLanguages(s("D.ITA", meta({ langs: { audio: [], subs: ["en"], multi: false } }))), ["it"]);
  assert.deepEqual(filterChips(list, sourceLanguages), ["no-hdr", "mp4", "cached", "verified", "audio:es", "audio:fr", "audio:multi"]);
  assert.deepEqual(applyFilters(list, new Set(["verified"]), sourceLanguages).kept.map((x) => x.title[0]), ["A"]);
  // No _meta anywhere: the chips are what they were.
  assert.deepEqual(filterChips([s("A.FRENCH"), s("B")], sourceLanguages), ["no-hdr", "mp4", "cached", "audio:fr"]);
});

test("settings: audio and subtitle languages, Automatic by default (no LANG_PREF), sent as LANG_PREF once chosen", () => {
  // Automatic: providers keep the worker's guess; the sources are ranked by the TV's language.
  assert.deepEqual(DEFAULT_SETTINGS.playback.audioLangs, []);
  assert.equal(langPref(DEFAULT_SETTINGS.playback), undefined);
  assert.deepEqual(audioLangsOf(DEFAULT_SETTINGS.playback), [systemLang()]);
  assert.equal(langPref({ audioLangs: [], subLangs: ["fr"] }), `${systemLang()};subs=fr`);
  assert.equal(langPref({ audioLangs: ["fr", "en"], subLangs: ["fr"] }), "fr,en;subs=fr");
  assert.equal(langPref({ audioLangs: ["fr"], subLangs: [] }), "fr");
  const merged = mergeSettings({ playback: { audioLangs: ["es", "EN", 3], subLangs: "fr" } } as never);
  assert.deepEqual([merged.playback.audioLangs, merged.playback.subLangs], [["es"], []]);
  const audio = SETTING_ITEMS.find((i) => i.id === "playback.audioLangs")!;
  const subs = SETTING_ITEMS.find((i) => i.id === "playback.subLangs")!;
  const auto = mergeSettings(null);
  assert.match(audio.getValue(auto), /^Automatic \(/);
  assert.deepEqual(audio.cycle(auto, 1).playback.audioLangs, ["en"]);
  assert.deepEqual(audio.cycle(auto, -1).playback.audioLangs, ["tr"]);
  const fr = mergeSettings({ playback: { audioLangs: ["fr"] } } as never);
  assert.equal(audio.getValue(fr), "French");
  assert.deepEqual(audio.cycle(fr, 1).playback.audioLangs, ["es"]);
  assert.deepEqual(audio.cycle(audio.cycle(fr, -1), -1).playback.audioLangs, []);
  assert.equal(subs.getValue(fr), "Same as audio");
  // Subtitles not chosen: those in the audio language count, and LANG_PREF still says nothing of them.
  assert.deepEqual(subLangsOf(fr.playback), ["fr"]);
  assert.deepEqual(subLangsOf({ audioLangs: ["fr"], subLangs: ["en"] }), ["en"]);
  assert.deepEqual(subs.cycle(fr, 1).playback.subLangs, ["en"]);
  assert.deepEqual(subs.cycle(subs.cycle(fr, 1), -1).playback.subLangs, []);
  // A TV language Settings does not list is kept, and cycles on into the list.
  const sv = mergeSettings({ playback: { audioLangs: ["sv"] } } as never);
  assert.equal(audio.getValue(sv), "SV");
  assert.deepEqual(audio.cycle(sv, 1).playback.audioLangs, ["en"]);
  assert.deepEqual(audio.cycle(sv, -1).playback.audioLangs, []);
});

test("device: a Samsung TV answers for 4K and HDR and never lists AV1; a browser asks MediaSource", () => {
  const tv = (uhd: boolean, hdr: boolean) =>
    probeCaps({ webapis: { productinfo: { isUdPanelSupported: () => uhd }, avinfo: { isHdrTvSupport: () => hdr } }, isTypeSupported: () => true });
  assert.equal(tv(true, true), "avc,hevc,hdr10,hdr10+,4k,aac,ac3,eac3,atmos");
  assert.equal(tv(false, false), "avc,hevc,aac,ac3,eac3,atmos");
  // An API that throws or is missing: the reference TV's answer.
  assert.equal(
    probeCaps({ webapis: { productinfo: { isUdPanelSupported: () => { throw new Error("no"); } } } }),
    "avc,hevc,hdr10,hdr10+,4k,aac,ac3,eac3,atmos",
  );
  assert.equal(probeCaps({ isTypeSupported: (t) => t.includes("av01") }), "avc,av1,hdr10,hdr10+,4k,aac,ac3,atmos");
  assert.equal(probeCaps({}), "avc,hevc,hdr10,hdr10+,4k,aac,ac3,eac3,atmos");
});

test("rankSources, Automatic languages: subtitles in the audio language beat other languages (FansubGroup-style anime)", () => {
  const ja = (subs: string[]) => meta({ verified: true, langs: { audio: ["ja"], subs, multi: false } });
  const list = [s("Ru.1080p", meta({ verified: true, langs: { audio: ["ru"], subs: [], multi: false } })), s("FansubGroup.1080p", ja(["en"])), s("Dual.1080p", meta({ verified: true, langs: { audio: ["ja", "en"], subs: [], multi: true } }))];
  const auto = { audioLangs: [] as string[], subLangs: [] as string[] };
  const langs = { audio: ["en"], subs: subLangsOf({ ...auto, audioLangs: ["en"] }) };
  assert.deepEqual(rankSources(list, { langs }).map((x) => x.title.split(".")[0]), ["Dual", "FansubGroup", "Ru"]);
});
