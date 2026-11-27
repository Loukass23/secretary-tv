import assert from "node:assert/strict";
import { test } from "node:test";
import { BANDS, bandShape, css, LEAN, luminance, type Rgb, sliceColours, stepBands } from "../src/lib/spoilerbands.ts";

/** A `w` x `h` picture where `at(x, y)` gives the colour. */
function picture(w: number, h: number, at: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = at(x, y);
      px.set([r, g, b, a], (y * w + x) * 4);
    }
  }
  return px;
}

test("spoiler bands: each band is its slice of the still, left to right", () => {
  // Left half red, right half blue: the first bands red, the last blue.
  const px = picture(40, 20, (x) => (x < 20 ? [200, 0, 0] : [0, 0, 200]));
  assert.deepEqual(sliceColours(px, 40, 20, 4), [
    [200, 0, 0],
    [200, 0, 0],
    [0, 0, 200],
    [0, 0, 200],
  ]);
  assert.equal(sliceColours(px, 40, 20).length, BANDS);
});

test("spoiler bands: transparent pixels do not count, and an empty slice is ink", () => {
  const px = picture(10, 2, (x) => (x < 5 ? [0, 0, 0, 0] : [100, 100, 100]));
  const [first, second] = sliceColours(px, 10, 2, 2);
  assert.deepEqual(first, [7, 8, 11]);
  assert.deepEqual(second, [100, 100, 100]);
});

test("spoiler bands: every band steps darker, and a white still keeps the white title readable", () => {
  const white: Rgb[] = Array.from({ length: BANDS }, () => [255, 255, 255] as const);
  const bands = stepBands(white);
  for (let k = 1; k < bands.length; k++) assert.ok(luminance(bands[k]) < luminance(bands[k - 1]), `band ${k} is darker than band ${k - 1}`);
  // The title is #f4f4f6: at least 3:1 against the lightest band, whatever the still.
  const title = luminance([244, 244, 246]);
  assert.ok((title + 0.05) / (luminance(bands[0]) + 0.05) >= 3, "contrast with the lightest band");
  assert.match(css(bands[0]), /^rgb\(\d+,\d+,\d+\)$/);
});

test("spoiler bands: the bands lean as the sheen does and cover the tile edge to edge", () => {
  const w = 320;
  const h = 180;
  const shapes = Array.from({ length: BANDS }, (_, k) => bandShape(k, BANDS, w, h));
  // Each starts where the one before ends, at the foot and at the top.
  for (let k = 1; k < BANDS; k++) {
    assert.equal(shapes[k][0][0], shapes[k - 1][1][0]);
    assert.equal(shapes[k][3][0], shapes[k - 1][2][0]);
  }
  // The corners of the tile are inside the first and the last band.
  assert.ok(shapes[0][0][0] <= 0 && shapes[0][3][0] <= 0);
  assert.ok(shapes[BANDS - 1][1][0] >= w && shapes[BANDS - 1][2][0] >= w);
  // The lean: the top is LEAN * h right of the foot.
  assert.ok(Math.abs(shapes[2][3][0] - shapes[2][0][0] - LEAN * h) < 1e-9);
});
