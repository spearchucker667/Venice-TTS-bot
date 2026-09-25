import assert from "node:assert/strict";
import test from "node:test";
import { stopTracks } from "./audio.ts";

test("stopTracks stops every track and ignores a missing stream", () => {
  let stopped = 0;
  stopTracks({
    getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }],
  });
  assert.equal(stopped, 2);
  stopTracks(null);
});
