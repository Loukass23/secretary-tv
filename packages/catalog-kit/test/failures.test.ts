import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, checkFailure, failureReason, worthProbing } from "../src/lib/failures.ts";

test("failure reasons in words, from checks and from the player", () => {
  assert.equal(failureReason(checkFailure({ verdict: "refused", status: 403 })), "server refused (403)");
  assert.equal(failureReason(checkFailure({ verdict: "warning clip", status: 206 })), "a placeholder clip, not the film");
  assert.equal(failureReason("not video"), "not a video (a web page or an error)");
  assert.equal(failureReason("no answer"), "the server did not answer");
  assert.equal(failureReason("prepare timed out"), "took too long to prepare");
  assert.equal(failureReason("no playable audio track"), "its audio cannot play on this TV");
  assert.equal(failureReason("prepare failed: PLAYER_ERROR_CONNECTION_FAILED"), "the connection failed");
  assert.equal(failureReason("open failed: PLAYER_ERROR_NOT_SUPPORTED_FILE"), "a format this TV cannot play");
  assert.equal(failureReason("play failed: PLAYER_ERROR_SEEK_FAILED"), "player error (seek failed)");
  assert.equal(failureReason("something odd"), "it would not play");
  assert.ok(worthProbing("prepare failed: PLAYER_ERROR_CONNECTION_FAILED") && !worthProbing("no playable audio track"));
  assert.deepEqual([ago(10_000), ago(12 * 60_000), ago(3 * 3600_000 + 5)], ["just now", "12 min ago", "3 h ago"]);
});
