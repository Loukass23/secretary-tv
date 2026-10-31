#!/usr/bin/env node
// Drives the app on the TV over the inspector port printed by `tizen.mjs debug`.
//   node scripts/cdp.mjs <port> eval "<expression>"
//   node scripts/cdp.mjs <port> keys Right Right Enter [--wait ms]   (named remote keys)
//   node scripts/cdp.mjs <port> logs <ms>                            (console output for a while)
//   node scripts/cdp.mjs <port> layers                               (what covers the video plane)
// Node 22 has a global WebSocket, so there are no dependencies.
const KEYS = {
  Enter: 13,
  Back: 27,
  Left: 37,
  Up: 38,
  Right: 39,
  Down: 40,
  Play: 415,
  Pause: 19,
  PlayPause: 10252,
  FastForward: 417,
  Rewind: 412,
  ChannelUp: 427,
  ChannelDown: 428,
  Search: 405,
  SearchVoice: 10225,
};

const [port, command, ...rest] = process.argv.slice(2);
if (!port || !command) {
  console.error("usage: cdp.mjs <port> eval|keys|logs ...");
  process.exit(1);
}

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((t) => t.webSocketDebuggerUrl);
if (!target) throw new Error("no inspectable page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m);
  else if (m.method === "Runtime.consoleAPICalled") {
    logs.push(`[${m.params.type}] ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Runtime.enable");

if (command === "eval") {
  const res = await send("Runtime.evaluate", { expression: rest.join(" "), returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(res.result?.result?.value ?? res.result?.exceptionDetails ?? res.result));
} else if (command === "keys") {
  const w = rest.indexOf("--wait");
  const wait = w >= 0 ? Number(rest[w + 1]) : 400;
  const names = w >= 0 ? rest.slice(0, w) : rest;
  for (const name of names) {
    const code = KEYS[name];
    if (!code) throw new Error(`unknown key ${name}`);
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: name });
    }
    await sleep(wait);
  }
  console.log(`sent ${names.join(" ")}`);
} else if (command === "walk") {
  // Fixed key walk with a frame-gap recorder in the page: the number to compare between builds.
  await send("Runtime.evaluate", {
    // Reset before the loop starts, so a second walk on the same page records too.
    expression: `window.__gaps=[];window.__stop=false;window.__last=0;(function f(t){if(window.__last)window.__gaps.push(t-window.__last);window.__last=t;if(!window.__stop)requestAnimationFrame(f)})(performance.now());1`,
  });
  // `walk <ms> Key,Key,...` replaces the default path (the glass lab has its own: docs/performance.md).
  const walk = rest[1]
    ? rest[1].split(",")
    : ["Right", "Right", "Right", "Right", "Right", "Right", "Down", "Right", "Right", "Right", "Down", "Left", "Left", "Left", "Left", "Up", "Up", "Left", "Left", "Left", "Left", "Left"];
  const bad = walk.filter((name) => !KEYS[name]);
  if (bad.length) throw new Error(`unknown key ${bad.join(", ")}`);
  for (const name of walk) {
    const code = KEYS[name];
    for (const type of ["keyDown", "keyUp"]) {
      await send("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: name });
    }
    await sleep(Number(rest[0] ?? 250));
  }
  const res = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `window.__stop=true;(()=>{const g=window.__gaps.slice().sort((a,b)=>a-b);const n=g.length;return JSON.stringify({frames:n,medianMs:Math.round(g[n>>1]),p95Ms:Math.round(g[Math.floor(n*0.95)]),maxMs:Math.round(g[n-1]),over50:g.filter(x=>x>50).length})})()`,
  });
  const heap = await send("Runtime.getHeapUsage");
  console.log(res.result.result.value, "heapMB", (heap.result.usedSize / 1048576).toFixed(1));
} else if (command === "soak") {
  // Browses for <minutes>, sampling heap, DOM nodes and images. Resolve calls are blocked in the page so
  // opening titles never adds torrents to the TorBox account, and prepare-ahead is off for the same reason.
  const minutes = Number(rest[0] ?? 30);
  await send("Runtime.evaluate", {
    expression: `localStorage.setItem('sectv.prepareAhead','false');const f=window.fetch.bind(window);window.fetch=(u,o)=>String(u).includes('/resolve/')?Promise.resolve(new Response(null,{status:204})):f(u,o);1`,
  });
  const press = async (names, wait = 300) => {
    for (const name of names) {
      const code = KEYS[name];
      for (const type of ["keyDown", "keyUp"]) {
        await send("Input.dispatchKeyEvent", { type, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: name });
      }
      await sleep(wait);
    }
  };
  const rep = (n, name) => Array(n).fill(name);
  const sample = async (label) => {
    await send("HeapProfiler.collectGarbage");
    const heap = await send("Runtime.getHeapUsage");
    const dom = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `JSON.stringify({nodes:document.getElementsByTagName('*').length,imgs:document.images.length,view:document.querySelector('.detail-glass')&&getComputedStyle(document.querySelector('.detail-glass')).display!=='none'?'detail':'home'})`,
    });
    console.log(`${new Date().toISOString().slice(11, 19)} ${label} heapMB=${(heap.result.usedSize / 1048576).toFixed(2)} ${dom.result.result.value}`);
  };
  const end = Date.now() + minutes * 60_000;
  await sample("start");
  for (let i = 0; Date.now() < end; i++) {
    const k = i % 5;
    await press([...rep(4, "Right"), "Down", ...rep(2, "Right"), "Down", ...rep(6, "Left"), "Up", "Up"]);
    await press([...rep(k, "Right"), "Enter"]);
    await sleep(2500);
    await press(["Down", "Down", "Right", "Right", "Right", "Left", "Up", "Up", "Back"]);
    await press(rep(k, "Left"));
    await sleep(1500);
    if (i % 5 === 4) await sample(`cycle ${i + 1}`);
  }
  await sample("end");
} else if (command === "shot") {
  const res = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(rest[0] ?? "shot.png", Buffer.from(res.result.data, "base64"));
  console.log(`wrote ${rest[0] ?? "shot.png"}`);
} else if (command === "layers") {
  // What is painted over AVPlay's video plane: screenshots show the plane blank, so check the stack instead.
  // Every element at five points, top first, with the styles that decide whether it hides the video.
  const res = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `JSON.stringify((()=>{const pts=[[960,540],[480,270],[1440,270],[480,810],[1440,810]];
const desc=(e)=>{const s=getComputedStyle(e);return [e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.classList.length?'.'+[...e.classList].join('.'):''),s.visibility,s.display,s.opacity,s.backgroundColor,s.zIndex].join(' ')};
const av=globalThis.webapis&&webapis.avplay;let state=null,pos=null;try{state=av.getState();pos=av.getCurrentTime()}catch(e){}
return {html:document.documentElement.className,avplay:{state,pos},points:pts.map(([x,y])=>({at:x+','+y,stack:document.elementsFromPoint(x,y).map(desc)}))}})())`,
  });
  console.log(JSON.stringify(JSON.parse(res.result.result.value), null, 2));
} else if (command === "logs") {
  await sleep(Number(rest[0] ?? 3000));
  console.log(logs.join("\n"));
}
ws.close();
process.exit(0);
