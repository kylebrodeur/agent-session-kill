import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOlderThan, parseDurationMs } from "../src/age.js";

describe("parseDurationMs", () => {
  it("parses day, hour, and minute durations", () => {
    assert.equal(parseDurationMs("14d"), 14 * 24 * 60 * 60 * 1000);
    assert.equal(parseDurationMs("6h"), 6 * 60 * 60 * 1000);
    assert.equal(parseDurationMs("30m"), 30 * 60 * 1000);
  });

  it("rejects malformed durations", () => {
    assert.throws(() => parseDurationMs("14"), /Invalid duration/);
    assert.throws(() => parseDurationMs("abc"), /Invalid duration/);
  });
});

describe("isOlderThan", () => {
  it("returns true only when mtime is older than threshold", () => {
    const now = 1_000_000;
    assert.equal(isOlderThan(now - 20_000, now, 10_000), true);
    assert.equal(isOlderThan(now - 5_000, now, 10_000), false);
  });
});
