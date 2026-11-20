import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPalette, fromOklch, paletteKey, homeMood, warmPalette } from "../src/glass/palette.ts";

const W = 32;
const H = 18;

/** An image of `W`x`H` pixels where `at(x, y)` gives the colour. */
function image(at: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b, a = 255] = at(x, y);
      px.set([r, g, b, a], (y * W + x) * 4);
    }
  }
  return px;
}

test("a red poster gives a red accent and a nearly black base", () => {
  const p = extractPalette(image((x) => (x < 20 ? [200, 30, 40] : [20, 20, 24])), W, H);
  assert.ok(p);
  const [r, g, b] = p.accent;
  assert.ok(r > g + 40 && r > b + 40, `accent ${p.accent}`);
  assert.ok(Math.max(...p.base) < 70, `base ${p.base}`);
  assert.ok(p.hue < 40 || p.hue > 330, `hue ${p.hue}`);
});

test("a blue poster gives a blue accent", () => {
  const p = extractPalette(image(() => [30, 70, 200]), W, H);
  assert.ok(p);
  assert.ok(p.accent[2] > p.accent[0] + 40, `accent ${p.accent}`);
});

test("grey, black-and-white and tiny art give no palette", () => {
  assert.equal(extractPalette(image(() => [120, 120, 120]), W, H), null);
  assert.equal(extractPalette(image((x) => (x % 2 ? [255, 255, 255] : [0, 0, 0])), W, H), null);
  assert.equal(extractPalette(new Uint8ClampedArray(8), 2, 1), null);
  assert.equal(extractPalette(image(() => [200, 30, 40, 0]), W, H), null);
});

test("skin tone loses to a blue shirt, but is kept when it is the only colour", () => {
  const skinAndBlue = image((x) => (x < 18 ? [224, 172, 140] : [30, 70, 200]));
  const p = extractPalette(skinAndBlue, W, H);
  assert.ok(p);
  assert.ok(p.accent[2] > p.accent[0], `accent ${p.accent}`);
  const onlySkin = extractPalette(image(() => [224, 150, 110]), W, H);
  assert.ok(onlySkin, "skin alone still gives a palette");
});

test("corner lights follow the side of the art they come from", () => {
  const p = extractPalette(image((x) => (x < 16 ? [220, 30, 30] : [30, 40, 220])), W, H);
  assert.ok(p);
  const [left, right] = p.lights;
  assert.ok(left[0] > left[2], `left ${left}`);
  assert.ok(right[2] > right[0], `right ${right}`);
});

test("fromOklch stays inside 0-255 and keeps lightness when chroma is too high", () => {
  for (const hue of [0, 1, 2, 3, 4, 5]) {
    const c = fromOklch(0.72, 0.4, hue);
    assert.ok(c.every((v) => v >= 0 && v <= 255));
  }
  const [r, g, b] = fromOklch(0.17, 0, 0);
  assert.ok(Math.abs(r - g) <= 1 && Math.abs(g - b) <= 1);
});

test("paletteKey is stable for near colours and distinct for far ones", () => {
  const a = extractPalette(image(() => [200, 30, 40]), W, H);
  const b = extractPalette(image(() => [202, 32, 41]), W, H);
  const c = extractPalette(image(() => [30, 70, 200]), W, H);
  assert.equal(paletteKey(a), paletteKey(b));
  assert.notEqual(paletteKey(a), paletteKey(c));
  assert.equal(paletteKey(null), "none");
});

test("home cards get a warm palette of their own, stable for the key", () => {
  const a = homeMood("weather");
  assert.deepEqual(homeMood("weather"), a);
  for (const key of ["assistant", "weather", "calendar", "apps", "reminders", "home"]) {
    const p = homeMood(key);
    // Warm: hue between red-orange and yellow, and the accent is red-heavy.
    assert.ok(p.hue >= 30 && p.hue <= 100, `${key} hue ${p.hue}`);
    assert.ok(p.accent[0] > p.accent[2], `${key} accent is warm`);
    assert.ok(p.base[0] < 60, `${key} base stays dark`);
  }
  assert.notEqual(paletteKey(warmPalette(40)), paletteKey(warmPalette(84)));
});
