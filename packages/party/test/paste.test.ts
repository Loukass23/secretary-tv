import { test } from "node:test";
import assert from "node:assert/strict";
import type { StorageLike } from "../src/cf.ts";
import { cleanPaste, PASTE_MAX, PASTE_TTL_MS, PasteBox, pastePage } from "../src/paste.ts";
import { createHandler, type Env } from "../src/service.ts";

const NOW = 1_800_000_000_000;

function memoryStorage(): StorageLike & { data: Map<string, unknown>; alarm?: number } {
  const data = new Map<string, unknown>();
  const s = {
    data,
    alarm: undefined as number | undefined,
    get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined,
    put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
    deleteAll: async () => data.clear(),
    setAlarm: async (at: number) => void (s.alarm = at),
    deleteAlarm: async () => void (s.alarm = undefined),
  };
  return s;
}

function service(withPastes = true) {
  const boxes = new Map<string, { obj: PasteBox; storage: ReturnType<typeof memoryStorage> }>();
  const env = {
    NUVIO_URL: "https://nuvio.test",
    NUVIO_KEY: "pk",
    TICKET_SECRET: "s",
    ROOMS: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response("", { status: 500 }) }) },
    ...(withPastes
      ? {
          PASTES: {
            idFromName: (name: string) => name,
            get: (id: unknown) => {
              const name = String(id);
              if (!boxes.has(name)) {
                const storage = memoryStorage();
                boxes.set(name, { obj: new PasteBox({ storage }, undefined, () => NOW), storage });
              }
              const { obj } = boxes.get(name)!;
              return { fetch: (input: Request | string, init?: RequestInit) => obj.fetch(input instanceof Request ? input : new Request(input, init)) };
            },
          },
        }
      : {}),
  } as Env;
  const handle = createHandler({ fetch: (async () => new Response("")) as typeof fetch, now: () => NOW });
  const call = (method: string, path: string, body?: object) =>
    handle(new Request(`https://party.test${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) }), env);
  return { call, boxes };
}

const CODE = "abcdefghjkmnpqrs";

test("the phone pastes, the TV reads it with a new rev; the box forgets after 15 minutes", async () => {
  const { call, boxes } = service();
  assert.deepEqual(await (await call("GET", `/type/${CODE}/text`)).json(), { text: "", rev: 0 });
  const token = "x".repeat(1100);
  assert.equal((await call("POST", `/type/${CODE}/text`, { text: token })).status, 200);
  const got = await call("GET", `/type/${CODE}/text`);
  assert.equal(got.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(await got.json(), { text: token, rev: 1 });
  const box = boxes.get(CODE)!;
  assert.equal(box.storage.alarm, NOW + PASTE_TTL_MS);
  await box.obj.alarm();
  assert.deepEqual(await (await call("GET", `/type/${CODE}/text`)).json(), { text: "", rev: 0 });
});

test("the page names what to paste; bad codes, bad bodies and a Worker without boxes are refused", async () => {
  const { call } = service();
  const page = await call("GET", `/type/${CODE}?for=AniList+token`);
  assert.match(page.headers.get("Content-Type") ?? "", /text\/html/);
  assert.match(await page.text(), /Paste your AniList token below/);
  assert.equal((await call("GET", "/type/SHORT/text")).status, 404);
  assert.equal((await call("POST", `/type/${CODE}/text`, { nope: 1 })).status, 400);
  assert.equal((await service(false).call("GET", `/type/${CODE}/text`)).status, 404);
});

test("pasted text loses control characters and stops at the limit; the page escapes its label", () => {
  assert.equal(cleanPaste("a\u0000b\tc\nd"), "ab\tc\nd");
  assert.equal(cleanPaste("y".repeat(PASTE_MAX + 50)).length, PASTE_MAX);
  assert.doesNotMatch(pastePage(CODE, "<script>"), /<script>alert|Paste your <script>/);
});
