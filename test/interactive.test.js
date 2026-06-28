import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runInteractive } from "../src/interactive.js";

class FakeInput extends EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.rawModes = [];
  }

  setRawMode(value) {
    this.rawModes.push(value);
  }

  resume() {}
}

describe("runInteractive", () => {
  it("restores raw mode if rendering throws", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-remnant-cleaner-interactive-"));
    const input = new FakeInput();
    const output = {
      isTTY: true,
      write() {
        throw new Error("render failed");
      },
    };

    try {
      await assert.rejects(
        runInteractive({
          homeDir: path.join(rootDir, "home"),
          tempDir: path.join(rootDir, "tmp"),
          olderThanMs: 1,
          includeCache: false,
          permanent: false,
          tools: new Set(["claude"]),
        }, {
          stdin: input,
          stdout: output,
          stderr: { write() {} },
        }),
        /render failed/,
      );
      assert.deepEqual(input.rawModes, [true, false]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
