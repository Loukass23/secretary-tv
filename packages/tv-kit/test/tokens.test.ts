import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ACCENT, DAY, FONTS, MOTION, NIGHT, PAGE_BG, RADII, TEXT_SIZES, TYPE_SCALE, TYPE_STYLES } from "../src/glass/tokens.ts";
import { typeAttrs } from "../src/glass/type.ts";

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
