import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error plain .mjs without types
import { renderManifest, readApplicationId } from "../../tv-kit/scripts/manifest.mjs";

const tpl = readFileSync(new URL("../tizen/config.xml.tpl", import.meta.url), "utf8");

test("fills package id and version", () => {
  const xml = renderManifest(tpl, { packageId: "ScrtMovies", version: "0.0.1" });
  assert.equal(readApplicationId(xml), "ScrtMovies.Movies");
  assert.match(xml, /version="0\.0\.1"/);
});

test("rejects a package id that is not 10 alphanumerics", () => {
  assert.throws(() => renderManifest(tpl, { packageId: "short", version: "0.0.1" }), /10 letters/);
});

test("rejects an out-of-range version", () => {
  assert.throws(() => renderManifest(tpl, { packageId: "ScrtMovies", version: "300.0.0" }), /not a Tizen version/);
});
