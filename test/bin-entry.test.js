import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Regression guard for the v0.2.0 bug: the entry guard compared
// `fileURLToPath(import.meta.url)` (the real cli.js path) against
// `process.argv[1]` (the .bin symlink path). They never matched under a `bin`
// install, so main() never ran and EVERY command silently no-op'd with exit 0.
//
// The unit tests import main() directly, so they never exercised the entry
// guard and stayed green while the shipped CLI was dead. This test invokes the
// CLI the way npm does — through a symlink — so it fails if the guard regresses.
describe("bin entry point (invoked through a symlink, like an npm install)", () => {
  const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));

  function runViaSymlink(args) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "ask-bin-"));
    const link = path.join(dir, "agent-session-kill");
    symlinkSync(cliPath, link);
    return execFileSync(process.execPath, [link, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  it("--version prints the version (main() actually runs)", () => {
    const out = runViaSymlink(["--version"]);
    assert.match(out.trim(), /^\d+\.\d+\.\d+/, `expected a version, got: ${JSON.stringify(out)}`);
  });

  it("--help prints usage (not an empty no-op)", () => {
    const out = runViaSymlink(["--help"]);
    assert.match(out, /Usage: agent-session-kill/, `expected usage text, got: ${JSON.stringify(out)}`);
  });

  it("scan --json emits parseable JSON with an entries array", () => {
    // Point home/temp at empty dirs so the scan is deterministic and fast.
    const empty = mkdtempSync(path.join(os.tmpdir(), "ask-empty-"));
    const out = runViaSymlink(["scan", "--json", "--home", empty, "--temp", empty]);
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed.entries), "expected an entries array in JSON output");
  });
});
