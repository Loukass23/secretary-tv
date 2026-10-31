import { test } from "node:test";
import assert from "node:assert/strict";
import { isRelease, normalizeCode } from "../src/protocol.ts";

test("release fingerprint: -1 file index and 0 size mean unknown; anything else out of range is refused", () => {
  const infoHash = "b".repeat(40);
  assert.equal(isRelease({ infoHash, fileIdx: 4, size: 1234 }), true);
  assert.equal(isRelease({ infoHash, fileIdx: -1, size: 0 }), true, "a source that names no file or size");
  assert.equal(isRelease({ infoHash, fileIdx: -2, size: 0 }), false);
  assert.equal(isRelease({ infoHash, fileIdx: 0, size: -1 }), false);
  assert.equal(isRelease({ infoHash, fileIdx: 0.5, size: 1 }), false);
});

test("room codes: typed codes are forgiven case, spaces and dashes; look-alike characters are not codes", () => {
  assert.equal(normalizeCode(" abc-234 "), "ABC234");
  assert.equal(normalizeCode("ABC0I1"), null);
  assert.equal(normalizeCode("ABC23"), null);
});
