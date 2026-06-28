import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanRemnants } from "../src/scanner.js";

const nowMs = Date.UTC(2026, 0, 15, 12, 0, 0);
const olderThanMs = 14 * 24 * 60 * 60 * 1000;
const oldMtime = new Date(nowMs - olderThanMs - 1_000);

async function withFakeRoots(run) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-remnant-cleaner-test-"));
  const homeDir = path.join(rootDir, "home");
  const tempDir = path.join(rootDir, "tmp");

  await mkdir(homeDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  try {
    await run({ homeDir, tempDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writeOldFile(filePath, contents = "old remnant\n") {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
  await utimes(filePath, oldMtime, oldMtime);
}

function scanOptions({ homeDir, tempDir, includeCache }) {
  return {
    homeDir,
    tempDir,
    nowMs,
    olderThanMs,
    includeCache,
    apply: false,
    permanent: false,
    tools: new Set(["claude", "pi", "omp", "temp"]),
  };
}

function entryFor(results, filePath) {
  return results.find((entry) => entry.path === filePath);
}

describe("scanRemnants", () => {
  it("marks old Claude task files for trash without trashing protected settings", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const taskFile = path.join(homeDir, ".claude", "tasks", "task-1.json");
      const settingsFile = path.join(homeDir, ".claude", "settings.json");

      await writeOldFile(taskFile, '{"task":"stale"}\n');
      await writeOldFile(settingsFile, '{"theme":"dark"}\n');

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const taskEntry = entryFor(results, taskFile);
      const settingsEntry = entryFor(results, settingsFile);

      assert.equal(taskEntry?.action, "trash");
      if (settingsEntry) {
        assert.equal(settingsEntry.action, "keep");
        assert.equal(settingsEntry.protected, true);
      }
    });
  });

  it("includes old Claude todos root as trash", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const todosDir = path.join(homeDir, ".claude", "todos");
      const todosFile = path.join(todosDir, "old.json");

      await writeOldFile(todosFile, '{"todo":"stale"}\n');

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const todosEntry = entryFor(results, todosFile);

      assert.equal(todosEntry?.action, "trash");
    });
  });

  it("keeps Claude and Pi cache roots by default", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const claudeCacheFile = path.join(homeDir, ".claude", "cache", "blob");
      const piCacheFile = path.join(homeDir, ".pi", "agent", "cache", "blob");

      await writeOldFile(claudeCacheFile, "cached\n");
      await writeOldFile(piCacheFile, "cached\n");

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));

      assert.equal(entryFor(results, claudeCacheFile)?.action, "keep");
      assert.equal(entryFor(results, piCacheFile)?.action, "keep");
    });
  });

  it("trashes Claude and Pi cache roots when cache cleanup is opted in", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const claudeCacheFile = path.join(homeDir, ".claude", "cache", "blob");
      const piCacheFile = path.join(homeDir, ".pi", "agent", "cache", "blob");

      await writeOldFile(claudeCacheFile, "cached\n");
      await writeOldFile(piCacheFile, "cached\n");

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: true }));

      assert.equal(entryFor(results, claudeCacheFile)?.action, "trash");
      assert.equal(entryFor(results, piCacheFile)?.action, "trash");
    });
  });

  it("marks old OMP session JSONL files for trash", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const sessionFile = path.join(homeDir, ".omp", "agent", "sessions", "project", "session.jsonl");

      await writeOldFile(sessionFile, '{"event":"stale"}\n');

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const sessionEntry = entryFor(results, sessionFile);

      assert.equal(sessionEntry?.action, "trash");
    });
  });

  it("keeps OMP cache by default and trashes it when cache cleanup is opted in", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const cacheFile = path.join(homeDir, ".omp", "cache", "blob.json");

      await writeOldFile(cacheFile, '{"cached":true}\n');

      const keptResults = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const trashedResults = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: true }));

      assert.equal(entryFor(keptResults, cacheFile)?.action, "keep");
      assert.equal(entryFor(trashedResults, cacheFile)?.action, "trash");
    });
  });

  it("scans Pi session-search index from the top-level .pi directory", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const indexFile = path.join(homeDir, ".pi", "session-search", "index", "segments", "old.idx");

      await writeOldFile(indexFile, "index\n");

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));

      assert.equal(entryFor(results, indexFile)?.action, "trash");
    });
  });

  it("scans OMP logs from the top-level .omp directory", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const logFile = path.join(homeDir, ".omp", "logs", "old.log");

      await writeOldFile(logFile, "log\n");

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));

      assert.equal(entryFor(results, logFile)?.action, "trash");
    });
  });

  it("scans pi-subagents chain-runs temp directories", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const chainFile = path.join(tempDir, "pi-subagents-user", "chain-runs", "run-1", "output.md");

      await writeOldFile(chainFile, "chain\n");

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));

      assert.equal(entryFor(results, chainFile)?.action, "trash");
    });
  });
});
