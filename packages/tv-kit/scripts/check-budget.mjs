#!/usr/bin/env node
// Fails the build when dist/ outgrows budget.json. Raise a limit only with the reason in the commit.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const APP = process.cwd();
const DIST = join(APP, "dist");
// A build with NEST_EMBED_CATALOG=1 carries the catalog as a lazy chunk (docs/embedding-catalog.md): it is held to
// budget.embed.json when the app has one.
const embedFile = (process.env.NEST_EMBED_CATALOG === "1" || process.env.NEST_EMBED_PLAYER !== "0") && existsSync(join(APP, "budget.embed.json")) ? "budget.embed.json" : "budget.json";
const budget = JSON.parse(readFileSync(join(APP, embedFile), "utf8"));

let total = 0;
let jsGzip = 0;
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "Debug") walk(p);
    } else {
      total += statSync(p).size;
      if (e.name.endsWith(".js")) jsGzip += gzipSync(readFileSync(p)).byteLength;
    }
  }
};
walk(DIST);

const checks = [
  ["JS gzip", jsGzip, budget.jsGzipBytes],
  ["dist total", total, budget.distBytes],
];
let failed = false;
for (const [name, value, limit] of checks) {
  const ok = value <= limit;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${(value / 1024).toFixed(1)} KB of ${(limit / 1024).toFixed(0)} KB`);
}
if (failed) process.exit(1);
