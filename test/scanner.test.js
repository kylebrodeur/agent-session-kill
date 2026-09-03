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
    tools: new Set(["claude", "pi", "omp", "temp", "copilot"]),
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
      const claudeCacheEntry = entryFor(results, claudeCacheFile);
      const piCacheEntry = entryFor(results, piCacheFile);

      assert.equal(claudeCacheEntry?.action, "keep");
      assert.equal(piCacheEntry?.action, "keep");
    });
  });

  it("scans a custom OMP session dir from options and ignores the default location", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const customDir = path.join(homeDir, "elsewhere", "omp-sessions");
      const customFile = path.join(customDir, "old-session.jsonl");
      const defaultFile = path.join(homeDir, ".omp", "agent", "sessions", "old.jsonl");

      await writeOldFile(customFile, '{"session":"old"}\n');
      await writeOldFile(defaultFile, '{"session":"old"}\n');

      const results = await scanRemnants({
        ...scanOptions({ homeDir, tempDir, includeCache: false }),
        ompSessionsDir: customDir,
      });
      const customEntry = results.find((e) => e.path === customFile);
      const defaultEntry = results.find((e) => e.path === defaultFile);

      assert.equal(customEntry?.action, "trash");
      assert.equal(customEntry?.category, "sessions");
      assert.equal(defaultEntry, undefined);
    });
  });

  it("resolves the OMP session dir from the mac-optimize config file", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const confDir = path.join(homeDir, ".config", "mac-optimize");
      const confFile = path.join(confDir, "omp-session-dir.conf");
      const customDir = path.join(homeDir, "config-sessions");
      const customFile = path.join(customDir, "old-session.jsonl");

      await writeOldFile(customFile, '{"session":"old"}\n');
      await mkdir(confDir, { recursive: true });
      await writeFile(confFile, `OMP_SESSION_DIR=${customDir}\n`);

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const customEntry = results.find((e) => e.path === customFile);

      assert.equal(customEntry?.action, "trash");
      assert.equal(customEntry?.category, "sessions");

      await rm(confFile, { force: true });
    });
  });

  it("prefers OMP_SESSION_DIR env over the config file and the flag over both", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const confDir = path.join(homeDir, ".config", "mac-optimize");
      const confFile = path.join(confDir, "omp-session-dir.conf");
      const envDir = path.join(homeDir, "env-sessions");
      const flagDir = path.join(homeDir, "flag-sessions");
      const confDirFiles = path.join(homeDir, "conf-sessions");

      await mkdir(confDir, { recursive: true });
      await writeFile(confFile, `OMP_SESSION_DIR=${confDirFiles}\n`);
      for (const [dir, name] of [[envDir, "env.jsonl"], [flagDir, "flag.jsonl"], [confDirFiles, "conf.jsonl"]]) {
        await writeOldFile(path.join(dir, name), '{"session":"old"}\n');
      }

      process.env.OMP_SESSION_DIR = envDir;
      try {
        const envResults = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
        assert.ok(envResults.find((e) => e.path === path.join(envDir, "env.jsonl")), "env dir scanned");
        assert.ok(!envResults.find((e) => e.path === path.join(confDirFiles, "conf.jsonl")), "config dir skipped when env set");

        const flagResults = await scanRemnants({
          ...scanOptions({ homeDir, tempDir, includeCache: false }),
          ompSessionsDir: flagDir,
        });
        assert.ok(flagResults.find((e) => e.path === path.join(flagDir, "flag.jsonl")), "flag dir scanned");
        assert.ok(!flagResults.find((e) => e.path === path.join(envDir, "env.jsonl")), "env dir skipped when flag set");
      } finally {
        delete process.env.OMP_SESSION_DIR;
        await rm(confFile, { force: true });
      }
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

  it("marks old Copilot ask-agent files for trash", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const chatFile = path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "github.copilot-chat", "ask-agent", "chat.json");

      await writeOldFile(chatFile, '{"session":"stale"}\n');

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));

      assert.equal(entryFor(results, chatFile)?.action, "trash");
    });
  });

  it("keeps Copilot commandEmbeddings by default and trashes it when cache is opted in", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const cacheFile = path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "github.copilot-chat", "commandEmbeddings.json");

      await writeOldFile(cacheFile, "cache\n");

      const keptResults = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const trashedResults = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: true }));

      assert.equal(entryFor(keptResults, cacheFile)?.action, "keep");
      assert.equal(entryFor(trashedResults, cacheFile)?.action, "trash");
    });
  });

  it("marks old Copilot workspace session files for trash", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const wsFile = path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "github.copilot-chat", "copilot.cli.workspaceSessions.abc123.json");

      await writeOldFile(wsFile, '{"ws":"stale"}\n');

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));

      assert.equal(entryFor(results, wsFile)?.action, "trash");
    });
  });

  it("keeps Copilot api.json even when old (protected path)", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      const apiFile = path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "github.copilot-chat", "api.json");

      await writeOldFile(apiFile, '{"api":"key"}\n');

      const results = await scanRemnants(scanOptions({ homeDir, tempDir, includeCache: false }));
      const entry = entryFor(results, apiFile);

      if (entry) {
        assert.equal(entry.action, "keep");
        assert.equal(entry.protected, true);
      }
    });
  });

  it("orphan detection: trashes new OMP session for a project no longer on disk", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      // Create workspace dir but NOT project-deleted inside it
      const workspaceDir = path.join(homeDir, "workspace");
      await mkdir(workspaceDir, { recursive: true });

      // The session dir encodes: homeDir + "/workspace/project-deleted"
      const sessionDir = path.join(homeDir, ".omp", "agent", "sessions", "-workspace-project-deleted");
      const sessionFile = path.join(sessionDir, "session.jsonl");

      // Write with a CURRENT (non-old) mtime so age alone would keep it
      await mkdir(sessionDir, { recursive: true });
      await writeFile(sessionFile, '{"event":"live"}\n');

      const results = await scanRemnants({
        ...scanOptions({ homeDir, tempDir, includeCache: false }),
        workspaceDir,
      });
      const entry = entryFor(results, sessionFile);

      assert.equal(entry?.action, "trash");
      assert.equal(entry?.reason, "orphaned session");
    });
  });

  it("orphan detection: keeps new OMP session for a project still on disk", async () => {
    await withFakeRoots(async ({ homeDir, tempDir }) => {
      // Create workspace dir AND the project dir
      const workspaceDir = path.join(homeDir, "workspace");
      const projectDir = path.join(workspaceDir, "exists");
      await mkdir(projectDir, { recursive: true });

      // Session dir encodes: homeDir + "/workspace/exists"
      const sessionDir = path.join(homeDir, ".omp", "agent", "sessions", "-workspace-exists");
      const sessionFile = path.join(sessionDir, "session.jsonl");

      // Write with a CURRENT (non-old) mtime
      await mkdir(sessionDir, { recursive: true });
      await writeFile(sessionFile, '{"event":"live"}\n');

      const results = await scanRemnants({
        ...scanOptions({ homeDir, tempDir, includeCache: false }),
        workspaceDir,
      });
      const entry = entryFor(results, sessionFile);

      assert.equal(entry?.action, "keep");
    });
  });
});
