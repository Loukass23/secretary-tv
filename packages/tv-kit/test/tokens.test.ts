import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCENT, ACCENTS, DAY, DISPLAY_FONTS, FONTS, MOTION, NIGHT, PAGE_BG, RADII, TEXT_SIZES, TYPE_SCALE, TYPE_STYLES } from "../src/glass/tokens.ts";
import { fontAttr, typeAttrs } from "../src/glass/type.ts";

const css = readFileSync(new URL("../src/glass/glass.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Map<string, string> {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  assert.ok(at >= 0, `${selector} not found in glass.css`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  const out = new Map<string, string>();
  for (const decl of body.split(";")) {
    const i = decl.indexOf(":");
    if (i > 0) out.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  return out;
}

test("night colours, radii and motion match .sg-root", () => {
  const root = rule(".sg-root");
  for (const [k, v] of Object.entries(NIGHT)) assert.equal(root.get(`--sg-${k}`), v, `--sg-${k}`);
  for (const [k, v] of Object.entries(RADII)) assert.equal(root.get(`--sg-r-${k}`), v, `--sg-r-${k}`);
  for (const [k, v] of Object.entries(MOTION)) assert.equal(root.get(`--sg-${k}`), v, `--sg-${k}`);
  assert.match(root.get("background") ?? "", new RegExp(`^${PAGE_BG.night}\\b`));
});

test("daylight colours match .sg-root.sg-day", () => {
  const day = rule(".sg-root.sg-day");
  for (const [k, v] of Object.entries(DAY)) assert.equal(day.get(`--sg-${k}`), v, `--sg-${k}`);
  assert.equal(day.get("background-color"), PAGE_BG.day);
});

test("every --sg variable on .sg-root has a token", () => {
  const known = new Set([
    ...Object.keys(NIGHT).map((k) => `--sg-${k}`),
    ...Object.keys(RADII).map((k) => `--sg-r-${k}`),
    ...Object.keys(MOTION).map((k) => `--sg-${k}`),
  ]);
  const missing = [...rule(".sg-root").keys()].filter((k) => k.startsWith("--sg-") && !known.has(k));
  assert.deepEqual(missing, []);
});

test("the accent, the type scale and the faces match :root", () => {
  const root = rule(":root");
  for (const [k, v] of Object.entries(ACCENT)) assert.equal(root.get(`--sg-${k}`), v, `--sg-${k}`);
  assert.equal(root.get("--sg-text"), String(TEXT_SIZES.normal.factor));
  for (const [k, t] of Object.entries(TYPE_SCALE)) assert.equal(root.get(`--sg-t-${k}`), `calc(${t.px}px * var(--sg-text))`, `--sg-t-${k}`);
  assert.equal(root.get("--sg-font-body"), FONTS.body);
  assert.equal(root.get("--sg-font-display"), FONTS.display);
  for (const [k, v] of Object.entries(TYPE_STYLES.studio.tokens)) assert.equal(root.get(`--sg-${k}`), v, `studio --sg-${k}`);
  const known = new Set([
    ...Object.keys(ACCENT).map((k) => `--sg-${k}`),
    "--sg-text",
    ...Object.keys(TYPE_SCALE).map((k) => `--sg-t-${k}`),
    "--sg-font-body",
    "--sg-font-display",
    ...Object.keys(TYPE_STYLES.studio.tokens).map((k) => `--sg-${k}`),
  ]);
  assert.deepEqual([...root.keys()].filter((k) => !known.has(k)), []);
});

test("each type style and text size has its rule, matching the tokens", () => {
  for (const [name, style] of Object.entries(TYPE_STYLES)) {
    if (name === "studio") continue;
    const r = rule(`:root[data-sg-type="${name}"]`);
    for (const [k, v] of Object.entries(style.tokens)) assert.equal(r.get(`--sg-${k}`), v, `${name} --sg-${k}`);
  }
  for (const [name, size] of Object.entries(TEXT_SIZES)) {
    if (name === "normal") continue;
    assert.equal(rule(`:root[data-sg-text="${name}"]`).get("--sg-text"), String(size.factor), name);
  }
});

test("the defaults put no attribute on the page", () => {
  assert.deepEqual(typeAttrs("studio", "normal"), {});
  assert.deepEqual(typeAttrs("bold", "large"), { "data-sg-type": "bold", "data-sg-text": "large" });
});

test("every font size in the glass is on the type scale", () => {
  const raw = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => m[1]);
  assert.deepEqual(raw, []);
});

test("each display face has its rule and its bundled file", () => {
  assert.equal(DISPLAY_FONTS.grotesk.family, FONTS.display);
  assert.deepEqual(fontAttr("grotesk"), {});
  for (const [name, f] of Object.entries(DISPLAY_FONTS)) {
    if (name === "grotesk") continue;
    assert.equal(rule(`:root[data-sg-font="${name}"]`).get("--sg-font-display"), f.family, name);
    const face = f.family.match(/^"([^"]+)"/)?.[1];
    assert.ok(face && css.includes(`font-family: "${face}";`), `@font-face for ${face}`);
  }
  for (const m of css.matchAll(/url\("\.\/fonts\/([^"]+)"\)/g)) assert.ok(readFileSync(new URL(`../src/glass/fonts/${m[1]}`, import.meta.url)).length > 0, m[1]);
});

/** WCAG contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** `color-mix(in srgb, a p%, b)` for two #rrggbb colours. */
function mix(a: string, b: string, p: number): string {
  const A = parseInt(a.slice(1), 16);
  const B = parseInt(b.slice(1), 16);
  return `#${[16, 8, 0].map((s) => Math.round(((A >> s) & 255) * p + ((B >> s) & 255) * (1 - p)).toString(16).padStart(2, "0")).join("")}`;
}

test("every accent's ink, and its text tint in both themes, holds 4.5:1", () => {
  assert.equal(ACCENT.accent, `var(--accent, ${ACCENTS.ember.hex})`);
  assert.equal(ACCENT["accent-ink"], `var(--tinta, ${ACCENTS.ember.ink})`);
  const night = Number(NIGHT["accent-text"].match(/ (\d+)%/)?.[1]) / 100;
  const day = Number(DAY["accent-text"].match(/ (\d+)%/)?.[1]) / 100;
  for (const [name, a] of Object.entries(ACCENTS)) {
    assert.ok(contrast(a.hex, a.ink) >= 4.5, `${name} ink`);
    assert.ok(contrast(mix(a.hex, "#ffffff", night), PAGE_BG.night) >= 4.5, `${name} night text`);
    assert.ok(contrast(mix(a.hex, DAY.ink, day), PAGE_BG.day) >= 4.5, `${name} day text`);
  }
});
