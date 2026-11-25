import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "@secretary/catalog-kit/src/lib/settings.ts";
import { appsOnCard } from "../src/apps.ts";
import { alertsShown, mayListen, remindersShown, speaksReply } from "../src/features.ts";

const on = DEFAULT_SETTINGS.home;

test("features: every one is on by default, as before the switches", () => {
  assert.deepEqual(on, { hiddenApps: [], reminders: true, homeAlerts: true, spokenReplies: true, listenOnFocus: true });
});

test("features: reminders off, the card, the bell and the greeting get none", () => {
  const items = [{ id: "1" }, { id: "2" }];
  assert.deepEqual(remindersShown(on, items), items);
  assert.deepEqual(remindersShown({ reminders: false }, items), []);
});

test("features: home notifications off, nothing is toasted or kept", () => {
  const news = [{ text: "The vacuum finished" }];
  assert.deepEqual(alertsShown(on, news), news);
  assert.deepEqual(alertsShown({ homeAlerts: false }, news), []);
});

test("features: spoken replies follow a voice question only while on", () => {
  assert.equal(speaksReply(on, true), true);
  assert.equal(speaksReply(on, false), false);
  assert.equal(speaksReply({ spokenReplies: false }, true), false);
});

test("features: listening on focus off, the microphone waits for OK or the mic key", () => {
  assert.equal(mayListen(on, true), true);
  assert.equal(mayListen({ listenOnFocus: false }, true), false);
  assert.equal(mayListen({ listenOnFocus: false }, false), true);
});

test("apps card: hidden apps and Secretary's own places are left out, a new app shows", () => {
  const apps = [
    { id: "settings.tv", name: "Settings" },
    { id: "AAAAAAAAAA.guide", name: "User Guide" },
    { id: "111299001912", name: "YouTube" },
    { id: "BBBBBBBBBB.music", name: "Music" },
  ];
  const hidden = ["AAAAAAAAAA.guide", "111299001912"];
  assert.deepEqual(appsOnCard(apps, hidden, ["settings.tv"]).map((a) => a.name), ["Music"]);
  const later = [...apps, { id: "CCCCCCCCCC.photos", name: "Photos" }];
  assert.deepEqual(appsOnCard(later, hidden, ["settings.tv"]).map((a) => a.name), ["Music", "Photos"]);
  assert.equal(appsOnCard(apps, []).length, 4);
});
