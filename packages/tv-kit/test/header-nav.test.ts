import { test } from "node:test";
import assert from "node:assert/strict";
import { headerStart, stepHeader } from "../src/glass/header-nav.ts";

test("Up opens the header on the person, else the first button", () => {
  assert.equal(headerStart(true, 7), "person");
  assert.equal(headerStart(false, 7), 0);
  assert.equal(headerStart(false, 0), null);
});

test("Left and Right walk person then buttons and stop at the ends; Down and Back leave", () => {
  assert.equal(stepHeader("person", "Right", true, 3), 0);
  assert.equal(stepHeader(0, "Left", true, 3), "person");
  assert.equal(stepHeader("person", "Left", true, 3), "person");
  assert.equal(stepHeader(2, "Right", true, 3), 2);
  assert.equal(stepHeader(0, "Left", false, 3), 0);
  assert.equal(stepHeader(1, "Down", true, 3), "leave");
  assert.equal(stepHeader(1, "Back", true, 3), "leave");
  assert.equal(stepHeader(1, "Up", true, 3), 1);
});
