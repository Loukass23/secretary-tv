#!/usr/bin/env node
// One-time SmartThings setup for Nest (docs/smartthings.md). Run from the repo root or an app folder.
//   node packages/tv-kit/scripts/smartthings.mjs create-app        registers the OAuth app with SMARTTHINGS_TOKEN (a
//                                                                  personal access token) and prints the client id and
//                                                                  secret for .env.tizen
//   node packages/tv-kit/scripts/smartthings.mjs authorize [port]  consent in the browser, then stores the token pair in
//                                                                  Nest over the inspector port from `tizen.mjs debug`
// Nest refreshes the pair from then on. Run `authorize` again if Nest says SmartThings needs signing in (a refresh
// token unused for 29 days expires, and a reinstall of Nest wipes it).
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { authorizeUrl, exchangeCode, ST_API, ST_SCOPES } from "../../smartthings/src/oauth.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const TOKENS_KEY = "nest.smartthings"; // launcher/src/home-control.ts

for (const name of [".env.tizen", ".env"]) {
  const path = join(REPO, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

// SmartThings rejects localhost redirects and seems to need a page that loads (a 404 one failed after sign-in), so the
// redirect is this repository's front page: it keeps the query string, and the code is read from the address bar.
const repoUrl = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).repository?.url?.replace(/\.git$/, "");
const REDIRECT = process.env.SMARTTHINGS_REDIRECT_URI || repoUrl;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

async function createApp() {
  const pat = process.env.SMARTTHINGS_TOKEN;
  if (!pat) fail("Set SMARTTHINGS_TOKEN in .env to a personal access token (account.smartthings.com/tokens) first.");
  const res = await fetch(`${ST_API}/apps`, {
    method: "POST",
    headers: { authorization: `Bearer ${pat}`, "content-type": "application/json" },
    body: JSON.stringify({
      appName: `secretary-tv-${randomBytes(3).toString("hex")}`,
      displayName: "Secretary TV",
      description: "Secretary Nest on your TV: lights, scenes and home status.",
      appType: "API_ONLY",
      classifications: ["CONNECTED_SERVICE"],
      singleInstance: true,
      oauth: { clientName: "Secretary TV", scope: ST_SCOPES, redirectUris: [REDIRECT] },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.oauthClientId) {
    fail(
      `SmartThings refused (${res.status}): ${JSON.stringify(body.error ?? body).slice(0, 300)}\n` +
        "The token may lack the apps scope. Create the app with the SmartThings CLI instead:\n" +
        "  npx @smartthings/cli apps:create   (choose OAuth-In App)\n" +
        `with the scopes ${ST_SCOPES.join(" ")} and the redirect URI ${REDIRECT}`,
    );
  }
  console.log(`Created "${body.app?.displayName}" (${body.app?.appName}). Add these to .env.tizen and redeploy Nest:\n`);
  console.log(`SMARTTHINGS_CLIENT_ID=${body.oauthClientId}`);
  console.log(`SMARTTHINGS_CLIENT_SECRET=${body.oauthClientSecret}`);
  console.log("\nThe secret is shown only now. Then run: node packages/tv-kit/scripts/smartthings.mjs authorize <inspector port>");
}

/** Runs an expression in the page behind the inspector port (the same route as cdp.mjs eval). */
async function evaluate(port, expression) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.webSocketDebuggerUrl);
  if (!target) throw new Error("no inspectable page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const out = await new Promise((resolve) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === 1) resolve(m.result?.result?.value ?? m.result?.exceptionDetails?.text);
    };
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }));
  });
  ws.close();
  return out;
}

function openBrowser(url) {
  // Not `cmd /c start`: cmd cuts the link at its first "&".
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // The link is printed too.
  }
}

async function authorize(port) {
  const clientId = process.env.SMARTTHINGS_CLIENT_ID;
  const clientSecret = process.env.SMARTTHINGS_CLIENT_SECRET;
  if (!clientId || !clientSecret) fail("Set SMARTTHINGS_CLIENT_ID and SMARTTHINGS_CLIENT_SECRET in .env.tizen (run create-app first).");
  const state = randomBytes(12).toString("hex");
  // PKCE (S256): SmartThings' consent page asks for it.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = authorizeUrl(clientId, REDIRECT, state, challenge);
  console.log(`Sign in to SmartThings and allow Secretary TV:\n\n  ${url}\n`);
  openBrowser(url);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const landed = (await rl.question("Then paste the address the browser ended on (it contains ?code=): ")).trim();
  rl.close();
  let params;
  try {
    params = new URL(landed).searchParams;
  } catch {
    fail("That is not an address.");
  }
  if (params.get("state") !== state) fail("That address is from another sign-in; start again.");
  const code = params.get("code");
  if (!code) fail(`No code in that address${params.get("error") ? ` (${params.get("error")})` : ""}.`);
  const tokens = await exchangeCode({ clientId, clientSecret }, code, REDIRECT, verifier);
  console.log("Signed in.");
  if (!port) {
    console.log(`\nNo inspector port given. Deploy Nest, run tizen.mjs debug, then store this in Nest's localStorage["${TOKENS_KEY}"]:`);
    console.log(JSON.stringify(tokens));
    return;
  }
  const value = JSON.stringify(JSON.stringify(tokens));
  const ok = await evaluate(port, `localStorage.setItem(${JSON.stringify(TOKENS_KEY)}, ${value}), "stored"`);
  if (ok !== "stored") fail(`Couldn't store the tokens in Nest: ${ok}`);
  console.log("Stored in Nest. It refreshes them from now on.");
}

const [command, arg] = process.argv.slice(2);
if (command === "create-app") await createApp();
else if (command === "authorize") await authorize(arg);
else fail("usage: smartthings.mjs create-app | authorize [inspector port]");
