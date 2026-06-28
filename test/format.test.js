import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatJson, formatTable } from "../src/format.js";

const results = {
  entries: [
    {
      tool: "claude",
      category: "tasks",
      path: "/home/user/.claude/tasks/task.json",
      type: "file",
      sizeBytes: 128,
      modifiedMs: Date.UTC(2026, 0, 1),
      action: "trash",
      reason: "older-than-threshold",
      protected: false,
    },
    {
      tool: "omp",
      category: "cache",
      path: "/home/user/.omp/cache/blob",
      type: "file",
      sizeBytes: 64,
      modifiedMs: Date.UTC(2026, 0, 2),
      action: "keep",
      reason: "cache-opt-out",
      protected: true,
    },
  ],
  errors: [],
};

describe("formatTable", () => {
  it("groups remnant entries with tool, category, and action columns", () => {
    const output = formatTable(results);

    assert.match(output, /tool/i);
    assert.match(output, /category/i);
    assert.match(output, /action/i);
    assert.match(output, /claude/);
    assert.match(output, /tasks/);
    assert.match(output, /trash/);
    assert.match(output, /omp/);
    assert.match(output, /cache/);
    assert.match(output, /keep/);
  });
});

describe("formatJson", () => {
  it("serializes scan results with entries", () => {
    const output = formatJson(results);
    const parsed = JSON.parse(output);

    assert.ok(Array.isArray(parsed.entries));
    assert.equal(parsed.entries.length, 2);
    assert.deepEqual(
      parsed.entries.map(({ tool, category, action }) => ({ tool, category, action })),
      [
        { tool: "claude", category: "tasks", action: "trash" },
        { tool: "omp", category: "cache", action: "keep" },
      ],
    );
  });
});
