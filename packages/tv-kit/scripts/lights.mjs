#!/usr/bin/env node
// Test routines for the lights' ripples (docs/smartthings.md), run from this PC with the same code Nest runs: tune the
// colours, timing and brightness here without deploying to the TV. Needs SMARTTHINGS_TOKEN in .env (a personal access
// token from account.smartthings.com/tokens; it lasts a day).
//   node packages/tv-kit/scripts/lights.mjs status                          the lights as Nest sees them, the sensor, the sound system
//   node packages/tv-kit/scripts/lights.mjs levels                          the ripple's brightness for a range of room light
//   node packages/tv-kit/scripts/lights.mjs ripple open|launch [--dry] [--lux N]
//                                                                           plays the ripple (--dry only prints its steps; --lux
//                                                                           pretends the sensor reads N) and then checks that every
//                                                                           light is back as it was
// Through Ask Nest the same ripples play on the TV: "ripple test" and "launch ripple".
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rippleLevel, rippleShow, roomLux, runShow, smartThings, staticToken } from "../../smartthings/src/index.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// The file wins over the shell: a stale token left in the environment would otherwise shadow a new one.
for (const name of [".env"]) {
  const path = join(REPO, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const token = process.env.SMARTTHINGS_TOKEN;
if (!token) fail("Set SMARTTHINGS_TOKEN in .env to a personal access token (account.smartthings.com/tokens) first.");
const st = smartThings({ token: staticToken(token) });

const describe = (d) => {
  const colour = d.colour ? ` ${d.saturation > 60 ? `colour ${d.hue}/${d.saturation}` : `white ${d.colorTemp}K`}` : "";
  return `${d.name.padEnd(18)} ${d.on === undefined ? "?" : d.on ? "on " : "off"}${d.level !== undefined ? ` ${String(d.level).padStart(3)}%` : "     "}${colour}`;
};
const lightsOf = (devices) => devices.filter((d) => d.kind === "light" || d.kind === "audio");

async function status() {
  const devices = await st.devices();
  for (const d of lightsOf(devices)) console.log(`${d.kind === "audio" ? "sound" : "light"}  ${describe(d)}`);
  const lux = roomLux(devices);
  console.log(`\nroom light: ${lux === null ? "no reading" : `${Math.round(lux)} lux`} -> ripple brightness ${rippleLevel(lux)}%`);
}

function levels() {
  console.log("lux    ripple brightness");
  for (const lux of [0, 10, 25, 50, 100, 150, 250, 400, 800]) console.log(`${String(lux).padStart(4)}   ${rippleLevel(lux)}%`);
  console.log(" none  ", `${rippleLevel(null)}%`);
}

async function ripple(style, args) {
  if (style !== "open" && style !== "launch") fail("ripple takes open or launch.");
  const dry = args.includes("--dry");
  const luxAt = args.indexOf("--lux");
  const lux = luxAt >= 0 ? Number(args[luxAt + 1]) : undefined;
  if (luxAt >= 0 && Number.isNaN(lux)) fail("--lux takes a number.");
  const before = await st.devices();
  const r = rippleShow(before, style, undefined, undefined, lux);
  if (!r) fail("No side lights found: the ripple needs lights named like “side light low”, “mid” and “top”.");
  const reading = lux ?? roomLux(before);
  console.log(`${style} ripple, room light ${reading === null ? "unknown" : `${Math.round(reading)} lux`} -> ${rippleLevel(reading)}%\nbefore:`);
  for (const d of lightsOf(before).filter((d) => r.undo.targets.some((t) => t.device.id === d.id))) console.log(`  ${describe(d)}`);
  console.log("\nsteps:");
  r.steps.forEach((s, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${s.targets.map((t) => `${t.device.name}: ${t.commands.map((c) => `${c.command}${c.arguments ? JSON.stringify(c.arguments) : ""}`).join(" ")}`).join(" | ")}  (+${s.after} ms)`),
  );
  if (dry) return console.log("\n--dry: nothing sent.");
  const t0 = Date.now();
  const { started, finished } = runShow(r.steps, {
    send: (t) => st.command(t.device.id, t.commands),
    undo: r.undo,
    onError: (e) => console.error("step failed, putting the lights back:", e.message ?? e),
  });
  await started;
  console.log(`\nfirst step sent after ${Date.now() - t0} ms`);
  await finished;
  console.log(`done after ${Date.now() - t0} ms; waiting for the lights to report`);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = await st.devices();
  let bad = 0;
  for (const t of r.undo.targets) {
    const was = before.find((d) => d.id === t.device.id);
    const now = after.find((d) => d.id === t.device.id);
    const same = was.on === now.on && was.level === now.level && was.colorTemp === now.colorTemp && was.hue === now.hue && was.saturation === now.saturation;
    if (!same) bad++;
    console.log(`  ${same ? "restored" : "DIFFERENT"}  ${describe(now)}${same ? "" : `   (was: ${describe(was).slice(18)})`}`);
  }
  console.log(bad ? `\n${bad} light(s) differ: a light off at the time reports its level only after it is on; check in the room.` : "\nevery light is back as it was.");
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "status") await status();
  else if (cmd === "levels") levels();
  else if (cmd === "ripple") await ripple(rest[0], rest);
  else fail("Usage: lights.mjs status | levels | ripple open|launch [--dry] [--lux N]");
} catch (e) {
  fail(`${e.message ?? e}${e.status === 401 ? "\nThe token in .env was refused: a personal access token lasts a day, so make a new one." : ""}`);
}
