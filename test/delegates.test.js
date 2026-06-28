import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDelegateDryRunCommands, runDelegateDryRuns } from "../src/delegates.js";

describe("buildDelegateDryRunCommands", () => {
  it("returns dry-run delegate command arrays without executing them", () => {
    const commands = buildDelegateDryRunCommands({ homeDir: "/home/user" });

    assert.deepEqual(commands, [
      ["claude", "project", "purge", "/home/user", "--dry-run"],
      ["omp", "worktree", "clear", "--dry-run"],
    ]);
    assert.ok(commands.every(Array.isArray));
  });
});

describe("runDelegateDryRuns", () => {
  it("captures delegate output instead of inheriting stdio when commands are missing", () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";

    try {
      let results;
      assert.doesNotThrow(() => {
        results = runDelegateDryRuns({ homeDir: "/home/user" });
      });

      assert.equal(results.length, 2);
      for (const result of results) {
        assert.deepEqual(Object.keys(result).sort(), ["command", "error", "signal", "status", "stderr", "stdout"]);
        assert.equal(typeof result.stdout, "string");
        assert.equal(typeof result.stderr, "string");
        assert.ok(result.error instanceof Error);
      }
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });
});
