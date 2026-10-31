import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { weatherPlaceFromEnv } from "./weather.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function loadEnvFile(filename: string) {
  const path = join(repoRoot, filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

// Load both .env and .env.tizen so SMARTTHINGS_TOKEN, GEMINI_API_KEY, and FANART_API_KEY are available.
loadEnvFile(".env");
loadEnvFile(".env.tizen");

const apiKey = process.env.TORBOX_API_KEY;
// Optional: the TV finds streams with Nuvio plugins (docs/plugins.md) and asks this addon only as a fallback.
const upstream = process.env.UPSTREAM_ADDON ?? "";
if (!apiKey) {
  console.error("Set TORBOX_API_KEY (see .env.example)");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 7000);

const handle = createApp({
  apiKey,
  baseUrl: process.env.BASE_URL ?? process.env.SECRETARY_TV_SERVER_URL ?? `http://localhost:${port}`,
  upstream: upstream && (/^https?:\/\//i.test(upstream) ? upstream : `https://${upstream}`).replace(/\/$/, ""),
  stateFile: resolve(repoRoot, ".secretary-state.json"),
  geminiApiKey: process.env.GEMINI_API_KEY,
  smartThingsToken: process.env.SMARTTHINGS_TOKEN,
  weather: weatherPlaceFromEnv(process.env),
});

const HOP_HEADERS = new Set(["host", "connection", "keep-alive", "content-length", "transfer-encoding", "upgrade"]);

createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    // The app reads content-type (/ai/transcribe); hop-by-hop headers stay here, the body is already whole.
    const headers = Object.entries(req.headers).flatMap(([k, v]) =>
      v == null || HOP_HEADERS.has(k) ? [] : [[k, Array.isArray(v) ? v.join(", ") : v] as [string, string]],
    );
    const out = await handle(new Request(`http://localhost${req.url ?? "/"}`, { method: req.method, body, headers }));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    if (out.body) Readable.fromWeb(out.body as never).pipe(res);
    else res.end();
  } catch {
    res.writeHead(500);
    res.end();
  }
}).listen(port, () => console.log(`Secretary TV server on :${port}`));
