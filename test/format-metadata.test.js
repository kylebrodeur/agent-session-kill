import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decorateEntry, decorateResults, formatTable } from "../src/format.js";

const base = {
  tool: "claude",
  category: "tasks",
  path: "/home/user/.claude/tasks/item.json",
  type: "file",
  sizeBytes: 128,
  modifiedMs: Date.UTC(2026, 0, 1),
  reason: "older-than-threshold",
};

describe("decorateEntry", () => {
  it("marks trash rows selectable with no risk", () => {
    const entry = decorateEntry({ ...base, action: "trash" });
    assert.equal(entry.selectable, true);
    assert.equal(entry.risk, "none");
  });

  it("marks keep and protected rows not selectable", () => {
    assert.equal(decorateEntry({ ...base, action: "keep" }).selectable, false);
    assert.equal(decorateEntry({ ...base, action: "trash", protected: true }).selectable, false);
    assert.equal(decorateEntry({ ...base, action: "trash", protected: true }).risk, "protected");
  });

  it("marks cache and delegate risk", () => {
    assert.equal(decorateEntry({ ...base, category: "cache", action: "trash" }).risk, "cache");
    assert.equal(decorateEntry({ ...base, action: "delegate" }).risk, "delegate");
  });
});

describe("decorateResults", () => {
  it("decorates entries and preserves errors", () => {
    const input = {
      entries: [{ ...base, action: "trash" }],
      errors: ["permission denied"],
    };

    const output = decorateResults(input);

    assert.equal(output.entries[0].selectable, true);
    assert.equal(output.entries[0].risk, "none");
    assert.deepEqual(output.errors, ["permission denied"]);
  });
});

describe("formatTable", () => {
  it("includes risk markers in plain output", () => {
    const text = formatTable(
      { entries: [{ ...base, category: "cache", action: "keep" }], errors: [] },
      { color: false },
    );

    assert.match(text, /Risk/);
    assert.match(text, /cache/);
  });
});
