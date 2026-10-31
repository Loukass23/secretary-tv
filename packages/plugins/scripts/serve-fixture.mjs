#!/usr/bin/env node
// Serves a folder (default: the slow test repository) to the TV over the LAN, for timing checks:
//   node packages/plugins/scripts/serve-fixture.mjs [folder] [port]
// Then add http://<this computer>:<port>/manifest.json in Settings › Sources on the TV.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(process.argv[2] ?? fileURLToPath(new URL("../test/fixtures/slow-repo", import.meta.url)));
const port = Number(process.argv[3] ?? 8790);
const TYPES = { ".json": "application/json", ".js": "text/javascript" };

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname));
  const file = join(root, path);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
  console.log(`${req.method} ${path}`);
}).listen(port, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces()).flat().find((a) => a?.family === "IPv4" && !a.internal)?.address;
  console.log(`serving ${root}\n  http://${lan ?? "localhost"}:${port}/manifest.json`);
});
