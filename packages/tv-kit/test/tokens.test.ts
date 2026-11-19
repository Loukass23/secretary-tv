import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DAY, MOTION, NIGHT, PAGE_BG, RADII } from "../src/glass/tokens.ts";

const css = readFileSync(new URL("../src/glass/glass.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Map<string, string> {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.]/g, "\\.")}\\s*\\{`));
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
