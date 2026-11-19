import { test } from "node:test";
import assert from "node:assert/strict";
import { durationMs, lintStyle, parseShadows, splitList } from "../src/lint.ts";
import { desktopKeyCode } from "../src/keymap.ts";

const rules = (s: Parameters<typeof lintStyle>[0], opts?: Parameters<typeof lintStyle>[1]) =>
  lintStyle(s, opts).map((i) => `${i.severity}:${i.rule}`);

test("splits lists on top-level commas only", () => {
  assert.deepEqual(splitList("rgba(0, 0, 0, 0.5) 0px 1px, red 0px 2px"), ["rgba(0, 0, 0, 0.5) 0px 1px", "red 0px 2px"]);
  assert.equal(durationMs("0.28s"), 280);
  assert.equal(durationMs("180ms"), 180);
});

test("a soft outer shadow is an error, inset hairlines and focus rings are not", () => {
  assert.deepEqual(parseShadows("rgba(0, 0, 0, 0.4) 0px 18px 40px 0px"), [{ inset: false, blur: 40, spread: 0 }]);
  assert.deepEqual(rules({ boxShadow: "rgba(0, 0, 0, 0.4) 0px 18px 40px 0px" }), ["error:soft-shadow"]);
  assert.deepEqual(rules({ boxShadow: "rgba(255, 255, 255, 0.11) 0px 0px 0px 1.5px inset" }), []);
  assert.deepEqual(rules({ boxShadow: "rgb(244, 244, 246) 0px 0px 0px 5px" }), []);
});

test("backdrop-filter is an error except in the live comparison mode", () => {
  assert.deepEqual(rules({ backdropFilter: "blur(26px)" }), ["error:backdrop-filter"]);
  assert.deepEqual(rules({ backdropFilter: "blur(26px)" }, { liveGlass: true }), []);
  assert.deepEqual(rules({ backdropFilter: "none" }), []);
});

test("CSS gradients and filter blurs are errors", () => {
  assert.deepEqual(rules({ backgroundImage: "linear-gradient(red, blue)" }), ["error:css-gradient"]);
  assert.deepEqual(rules({ backgroundImage: 'url("blob:x")' }), []);
  assert.deepEqual(rules({ filter: "blur(4px)" }), ["error:filter-blur"]);
});

test("only transform and opacity may animate, on their own layer", () => {
  assert.deepEqual(rules({ transitionProperty: "width, opacity", transitionDuration: "0.2s", willChange: "opacity" }), [
    "error:animated-layout",
  ]);
  assert.deepEqual(rules({ transitionProperty: "transform", transitionDuration: "220ms", willChange: "auto" }), ["warn:no-layer"]);
  assert.deepEqual(rules({ transitionProperty: "transform", transitionDuration: "220ms", willChange: "transform" }), []);
  // An inline translate3d (the frost, scrolled rows) is its own layer already.
  assert.deepEqual(rules({ transitionProperty: "transform", transitionDuration: "280ms", inlineTransform: "translate3d(-80px,-96px,0) scale(4)" }), []);
  // The computed default: all, 0s, animates nothing.
  assert.deepEqual(rules({ transitionProperty: "all", transitionDuration: "0s" }), []);
  assert.deepEqual(rules({ transitionProperty: "all", transitionDuration: "0.3s", willChange: "transform" }), ["warn:animated-layout"]);
});

test("keyframes that move layout are errors", () => {
  const keyframes = new Map([["grow", new Set(["height"])], ["rise", new Set(["transform", "opacity"])]]);
  assert.deepEqual(rules({ animationName: "grow" }, { keyframes }), ["error:animated-layout"]);
  assert.deepEqual(rules({ animationName: "rise" }, { keyframes }), []);
});

test("desktop keys stand in for the remote", () => {
  assert.equal(desktopKeyCode("Backspace"), 10009);
  assert.equal(desktopKeyCode("1"), 403);
  assert.equal(desktopKeyCode(" "), 10252);
  assert.equal(desktopKeyCode("ArrowLeft"), null);
});
