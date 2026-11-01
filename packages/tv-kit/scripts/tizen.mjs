#!/usr/bin/env node
// Tizen device pipeline. Run from an app folder: node ../tv-kit/scripts/tizen.mjs <command...>
// Build, package, install and launch for the Tizen apps (see docs/launcher.md and the README).
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readApplicationId, renderManifest } from "./manifest.mjs";

// Run from an app folder (packages/<app>): that folder is the app, the repo root holds .env.tizen.
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = process.cwd();
const REPO = resolve(APP, "../..");
const appPkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
// Each app has its own package id, named by "tizen.packageIdEnv" in its package.json.
const ID_ENV = appPkg.tizen?.packageIdEnv ?? "SECRETARY_TV_PACKAGE_ID";
const DIST = join(APP, "dist");
// tz treats the folder as a project and writes these into it.
const PACKAGING = ["Debug", "tizen_web_project.yaml", ".tizen-rds"];

// .env.tizen (repo root, gitignored) holds the signing profile and TV address; .env (also gitignored) holds the
// debrid keys a build may carry for its owner (docs/plugins.md). .env.tizen wins over .env, the environment over
// both. None is ever printed.
function loadEnv() {
  for (const name of [".env.tizen", ".env"]) loadEnvFile(join(REPO, name));
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    const value = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: APP, shell: true });
  if (res.status !== 0) throw new Error(`${cmd} ${args[0] ?? ""} failed with exit code ${res.status}`);
}

function capture(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "pipe"] });
}

function serial() {
  if (process.env.SECRETARY_TV_SERIAL) return process.env.SECRETARY_TV_SERIAL;
  const devices = capture("sdb", ["devices"])
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/))
    .filter((c) => c[1] === "device");
  if (devices.length === 1) return devices[0][0];
  throw new Error(
    devices.length === 0
      ? "no Tizen device connected (sdb connect <tv-ip>)"
      : `${devices.length} devices; set SECRETARY_TV_SERIAL to one of: ${devices.map((d) => d[0]).join(", ")}`,
  );
}

function manifestXml() {
  const path = join(DIST, "config.xml");
  if (!existsSync(path)) throw new Error("dist/config.xml is missing; run package first");
  return readFileSync(path, "utf8");
}

const packageId = () => readApplicationId(manifestXml()).split(".")[0];

function wgtPath() {
  const out = join(DIST, "Debug");
  const found = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith(".wgt")) : [];
  if (found.length !== 1) throw new Error("no .wgt in dist/Debug; run package first");
  return join(out, found[0]);
}

function build() {
  // An address, not a secret: the TV reaches the server at this LAN URL.
  if (process.env.SECRETARY_TV_SERVER_URL === undefined) process.env.SECRETARY_TV_SERVER_URL = "";
  run("pnpm", ["exec", "vite", "build"]);
  run("node", [join(KIT, "scripts/check-budget.mjs")]);
}

function pack() {
  if (!existsSync(join(DIST, "index.html"))) throw new Error("dist has no build; run build first");
  const { version } = appPkg;
  const template = readFileSync(join(APP, "tizen/config.xml.tpl"), "utf8");
  writeFileSync(
    join(DIST, "config.xml"),
    renderManifest(template, { packageId: process.env[ID_ENV], version, idName: ID_ENV }),
  );
  const own = join(APP, "tizen/icon.png");
  copyFileSync(existsSync(own) ? own : join(KIT, "tizen/icon.png"), join(DIST, "icon.png"));
  for (const leftover of PACKAGING) rmSync(join(DIST, leftover), { recursive: true, force: true });
  // Empty profile: tz signs with the active profile from Certificate Manager.
  if (process.env.SECRETARY_TV_PROFILE) run("tz", ["set", "-w", DIST, "-s", process.env.SECRETARY_TV_PROFILE]);
  run("tz", ["pack", "-w", DIST]);
  console.log(`\npackaged ${wgtPath()}`);
}

// `tz install` uninstalls first, which wipes the app's localStorage: the Nuvio sign-in, Nest's SmartThings tokens,
// reminders and cached weather. The TV's own installer upgrades in place and keeps it (checked on the reference TV,
// 2026-11-01). `reinstall` is the old way, for when the package's signature changed and an upgrade is refused.
function install() {
  const target = serial();
  const id = packageId();
  const remote = `/home/owner/share/tmp/sdk_tools/${id}.wgt`;
  run("sdb", ["-s", target, "push", `"${wgtPath()}"`, remote]);
  console.log(`\n> sdb -s ${target} shell 0 vd_appinstall ${id} ${remote}`);
  const res = spawnSync("sdb", ["-s", target, "shell", "0", "vd_appinstall", id, remote], { cwd: APP, shell: true, encoding: "utf8" });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  console.log(out.trim().split(/\r?\n/).slice(-2).join("\n"));
  // sdb's shell exits 0 whatever the installer says, so read its last word.
  if (!/install completed/.test(out)) {
    throw new Error("in-place install failed (a new signing certificate?); `reinstall` uninstalls first and wipes the app's data");
  }
}

const reinstall = () => run("tz", ["install", "-e", serial(), "-p", wgtPath()]);
const launch = () => run("tz", ["run", "-e", serial(), "-p", packageId()]);

function debug() {
  const target = serial();
  const appId = readApplicationId(manifestXml());
  spawnSync("sdb", ["-s", target, "shell", "0", "was_kill", packageId()], { shell: true, stdio: "ignore" });
  const out = capture("sdb", ["-s", target, "shell", "0", "debug", appId]);
  const port = /port:\s*(\d+)/i.exec(out)?.[1];
  if (!port) throw new Error(`no inspector port in debug output:\n${out.trim()}`);
  run("sdb", ["-s", target, "forward", `tcp:${port}`, `tcp:${port}`]);
  console.log(`\nCDP: http://127.0.0.1:${port}/json/list`);
}

const commands = {
  build,
  package: pack,
  install,
  reinstall,
  launch,
  debug,
  deploy() {
    build();
    pack();
    install();
    launch();
  },
};

const requested = process.argv.slice(2);
const unknown = requested.filter((c) => !commands[c]);
if (requested.length === 0 || unknown.length) {
  console.error(`usage: node scripts/tizen.mjs <${Object.keys(commands).join("|")}>...`);
  process.exit(1);
}

loadEnv();
try {
  for (const command of requested) await commands[command]();
} catch (err) {
  console.error(`\ntizen: ${err.message}`);
  process.exit(1);
}
