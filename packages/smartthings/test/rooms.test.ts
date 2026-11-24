import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByRoom, NO_ROOM, smartThings, type StDevice, type StRoom } from "../src/index.ts";

const BASE = "https://api.smartthings.com/v1";

// Shaped like SmartThings' own answers (field names, paging links), with made-up ids and names.
const ROOMS_PAGE_1 = {
  items: [
    { roomId: "room-living", locationId: "loc-home", name: "Living room", backgroundImage: null },
    { roomId: "room-kitchen", locationId: "loc-home", name: " Kitchen " },
  ],
  _links: { next: { href: `${BASE}/locations/loc-home/rooms?page=1` }, previous: null },
};
const ROOMS_PAGE_2 = { items: [{ roomId: "room-bed", locationId: "loc-home", name: "Bedroom" }], _links: { next: null } };
const CABIN_ROOMS = { items: [{ roomId: "room-cabin", locationId: "loc-cabin", name: "Living room" }], _links: {} };
const SCENES = {
  items: [
    { sceneId: "scene-film", sceneName: "Film night", sceneIcon: "204", sceneColor: null, locationId: "loc-home", createdBy: "user-1", lastExecutedDate: 1_795_000_000_000, editable: false },
    { sceneId: "scene-wake", sceneName: " Good morning ", locationId: "loc-home", lastExecutedDate: null },
    { sceneName: "Broken, no id" },
  ],
  _links: { next: { href: `${BASE}/scenes?page=1` } },
};
const SCENES_2 = { items: [{ sceneId: "scene-off", sceneName: "All off", locationId: "loc-home" }], _links: { next: null } };

function fakeApi(pages: Record<string, unknown>, expiredToken = "old") {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(BASE, "");
    const auth = (init?.headers as Record<string, string>).authorization;
    calls.push(`${init?.method ?? "GET"} ${path} ${auth}`);
    if (auth === `Bearer ${expiredToken}`) return new Response('{"error":"unauthorized"}', { status: 401 });
    const body = pages[path];
    return body === undefined ? new Response("", { status: 404 }) : new Response(JSON.stringify(body));
  }) as typeof fetch;
  return { f, calls };
}

test("rooms: every page of every home, refreshing once on a 401 as for devices", async () => {
  const { f, calls } = fakeApi({
    "/locations/loc-home/rooms": ROOMS_PAGE_1,
    "/locations/loc-home/rooms?page=1": ROOMS_PAGE_2,
    "/locations/loc-cabin/rooms": CABIN_ROOMS,
  });
  let refreshed = 0;
  const st = smartThings({ token: async (force) => (force ? (refreshed++, "new") : "old"), fetch: f });

  const rooms = await st.roomsIn(["loc-home", "loc-cabin", "loc-home", ""]);
  assert.deepEqual(rooms, [
    { id: "room-living", name: "Living room", locationId: "loc-home" },
    { id: "room-kitchen", name: "Kitchen", locationId: "loc-home" },
    { id: "room-bed", name: "Bedroom", locationId: "loc-home" },
    { id: "room-cabin", name: "Living room", locationId: "loc-cabin" },
  ]);
  // This fake source keeps handing out the expired token until forced, so each page meets a 401 and is sent once more
  // with the refreshed one, the next page included. Locations already asked for are not asked again.
  assert.equal(refreshed, 3);
  assert.ok(calls.includes("GET /locations/loc-home/rooms?page=1 Bearer new"));
  assert.equal(calls.filter((c) => c.endsWith("Bearer new")).length, 3);
  assert.equal(calls.length, 6);
  assert.deepEqual(await st.rooms("loc-cabin"), { "room-cabin": "Living room" });
});

test("rooms: a failing location fails the call, and a next link off the API is not followed", async () => {
  const { f, calls } = fakeApi({
    "/locations/loc-home/rooms": { items: [{ roomId: "room-a", name: "A" }], _links: { next: { href: "https://example.com/elsewhere" } } },
  });
  const st = smartThings({ token: async () => "good", fetch: f });
  assert.deepEqual(await st.roomsIn(["loc-home"]), [{ id: "room-a", name: "A", locationId: "loc-home" }]);
  assert.equal(calls.length, 1);
  await assert.rejects(st.roomsIn(["loc-home", "loc-gone"]), /404/);
});

test("scenes (routines): every page, names trimmed, the last run kept, items without an id dropped", async () => {
  const { f } = fakeApi({ "/scenes": SCENES, "/scenes?page=1": SCENES_2 });
  const st = smartThings({ token: async () => "good", fetch: f });
  assert.deepEqual(await st.scenes(), [
    { id: "scene-film", name: "Film night", locationId: "loc-home", lastRun: 1_795_000_000_000 },
    { id: "scene-wake", name: "Good morning", locationId: "loc-home" },
    { id: "scene-off", name: "All off", locationId: "loc-home" },
  ]);
});

test("a list whose next link loops stops after a bounded number of pages", async () => {
  const { f, calls } = fakeApi({ "/scenes": { items: [{ sceneId: "s", sceneName: "S" }], _links: { next: { href: `${BASE}/scenes` } } } });
  const st = smartThings({ token: async () => "good", fetch: f });
  assert.equal((await st.scenes()).length, 20);
  assert.equal(calls.length, 20);
});

const light = (id: string, name: string, roomId?: string): StDevice => ({ id, name, kind: "light", local: false, dimmable: false, ...(roomId ? { roomId } : {}) });
const ROOMS: StRoom[] = [
  { id: "r-living", name: "Living room", locationId: "loc-home" },
  { id: "r-kitchen", name: "kitchen", locationId: "loc-home" },
  { id: "r-empty", name: "Attic", locationId: "loc-home" },
  { id: "r-cabin", name: "Living room", locationId: "loc-cabin" },
];

test("groupByRoom: rooms by name, devices by name, rooms with none left out, no room last", () => {
  const groups = groupByRoom(
    [
      light("d1", "Sofa lamp", "r-living"),
      light("d2", "Ceiling", "r-kitchen"),
      light("d3", "Desk 10", "r-living"),
      light("d4", "Desk 9", "r-living"),
      light("d5", "Porch"),
      light("d6", "Garage", "r-unknown"),
      light("d7", "Cabin lamp", "r-cabin"),
    ],
    ROOMS,
  );
  assert.deepEqual(
    groups.map((g) => [g.id, g.name, g.devices.map((d) => d.name)]),
    [
      ["r-kitchen", "kitchen", ["Ceiling"]],
      ["r-living", "Living room", ["Desk 9", "Desk 10", "Sofa lamp"]],
      ["r-cabin", "Living room", ["Cabin lamp"]],
      [null, NO_ROOM, ["Garage", "Porch"]],
    ],
  );
});

test("groupByRoom: without rooms (not loaded yet) everything is one last group; nothing gives nothing", () => {
  assert.deepEqual(
    groupByRoom([light("d1", "B", "r-living"), light("d2", "A")], []).map((g) => [g.id, g.devices.map((d) => d.id)]),
    [[null, ["d2", "d1"]]],
  );
  assert.deepEqual(groupByRoom([], ROOMS), []);
});
