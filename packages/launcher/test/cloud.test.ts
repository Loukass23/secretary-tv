import { test } from "node:test";
import assert from "node:assert/strict";
import { grantKey, needsGrant } from "../src/cloud.ts";

const me = grantKey("u1", 3);
const at = 1_793_378_683_000;

test("an app gets a session once per account and profile, never while signed out", () => {
  assert.ok(needsGrant(undefined, me, at));
  assert.ok(!needsGrant({ owner: me, installed: at }, me, at));
  assert.ok(needsGrant({ owner: grantKey("u1", 1), installed: at }, me, at), "another profile");
  assert.ok(needsGrant({ owner: grantKey("u2", 3), installed: at }, me, at), "another account");
  assert.ok(!needsGrant(undefined, null, at));
  assert.ok(!needsGrant({ owner: me, installed: at }, null, at + 1000));
});

test("a reinstalled app gets a session again", () => {
  assert.ok(needsGrant({ owner: me, installed: at }, me, at + 60_000));
  assert.ok(needsGrant({ owner: me, installed: null }, me, at), "install time learned since");
});

test("an unknown install time keeps the grant", () => {
  assert.ok(!needsGrant({ owner: me, installed: at }, me, null));
  assert.ok(!needsGrant({ owner: me, installed: null }, me, null));
});

test("a grant recorded before install times is replaced once", () => {
  assert.ok(needsGrant(me, me, at));
  assert.ok(!needsGrant(me, me, null));
  assert.ok(needsGrant(grantKey("u1", 1), me, null), "another profile");
});
