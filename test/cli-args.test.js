import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { main, parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  it("keeps --dry-run authoritative when it appears before --apply", () => {
    const parsed = parseCliArgs(["clean", "--dry-run", "--apply"]);

    assert.equal(parsed.options.apply, false);
  });

  it("keeps --dry-run authoritative when it appears after --apply", () => {
    const parsed = parseCliArgs(["clean", "--apply", "--dry-run"]);

    assert.equal(parsed.options.apply, false);
  });

  it("routes no command to interactive mode", () => {
    const parsed = parseCliArgs([]);

    assert.equal(parsed.command, "interactive");
  });

  it("routes explicit interactive command to interactive mode", () => {
    const parsed = parseCliArgs(["interactive", "--older-than", "7d"]);

    assert.equal(parsed.command, "interactive");
    assert.equal(parsed.options.olderThan, "7d");
  });

  it("keeps scan non-interactive", () => {
    const parsed = parseCliArgs(["scan", "--json"]);

    assert.equal(parsed.command, "scan");
    assert.equal(parsed.options.json, true);
    assert.equal(parsed.options.apply, false);
  });
});

describe("main", () => {
  it("does not scan when --help is requested", async () => {
    let stdout = "";
    const exitCode = await main(["--help"], {
      stdout: {
        write(text) {
          stdout += text;
        },
      },
      stderr: { write() {} },
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /interactive/);
  });

  it("fails fast for default interactive mode without a TTY", async () => {
    let stderr = "";
    const exitCode = await main([], {
      stdin: { isTTY: false },
      stdout: { write() {} },
      stderr: { write(text) { stderr += text; } },
    });

    assert.equal(exitCode, 1);
    assert.match(stderr, /requires a TTY/);
  });

  it("prints the manifest before applying cleanup", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-remnant-cleaner-cli-"));
    const homeDir = path.join(rootDir, "home");
    const tempDir = path.join(rootDir, "tmp");
    const target = path.join(homeDir, ".claude", "tasks", "old.json");
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(tempDir, { recursive: true });
    await writeFile(target, "old\n");
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await import("node:fs/promises").then((fs) => fs.utimes(target, oldDate, oldDate));

    let fileExistedWhenManifestPrinted = false;
    const io = {
      stdout: {
        write(text) {
          if (text.includes(target)) {
            fileExistedWhenManifestPrinted = existsSync(target);
          }
        },
      },
      stderr: { write() {} },
    };

    try {
      const exitCode = await main(["clean", "--apply", "--permanent", "--home", homeDir, "--temp", tempDir, "--older-than", "14d", "--tool", "claude"], io);
      assert.equal(exitCode, 0);
      assert.equal(fileExistedWhenManifestPrinted, true);
      await assert.rejects(access(target));
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
