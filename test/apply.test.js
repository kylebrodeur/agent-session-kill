import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyManifest } from "../src/apply.js";

async function withFakeHome(run) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "agent-remnant-cleaner-apply-test-"));
  const homeDir = path.join(rootDir, "home");

  await mkdir(homeDir, { recursive: true });

  try {
    await run({ homeDir });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writeFixture(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function manifestEntry(filePath, overrides = {}) {
  return {
    tool: "claude",
    category: "tasks",
    path: filePath,
    type: "file",
    sizeBytes: 16,
    modifiedMs: Date.UTC(2026, 0, 1),
    action: "trash",
    reason: "older than threshold",
    protected: false,
    ...overrides,
  };
}

describe("applyManifest", () => {
  it("permanently deletes unprotected delete entries and skips protected delete entries", async () => {
    await withFakeHome(async ({ homeDir }) => {
      const deleteFile = path.join(homeDir, ".claude", "tasks", "delete-me.json");
      const protectedFile = path.join(homeDir, ".claude", "settings.json");

      await writeFixture(deleteFile, "delete me\n");
      await writeFixture(protectedFile, "protected\n");

      const result = await applyManifest(
        {
          entries: [
            manifestEntry(deleteFile, { action: "delete" }),
            manifestEntry(protectedFile, {
              category: "settings",
              action: "delete",
              protected: true,
              reason: "protected path",
            }),
          ],
          errors: [],
        },
        { homeDir, permanent: true },
      );

      assert.equal(result.deleted, 1);
      assert.equal(result.trashed, 0);
      assert.equal(result.skipped, 1);
      assert.deepEqual(result.errors, []);
      assert.equal(await pathExists(deleteFile), false);
      assert.equal(await pathExists(protectedFile), true);
      assert.equal(await readFile(protectedFile, "utf8"), "protected\n");
    });
  });

  it("moves trash entries to the configured trash directory and counts them", async () => {
    await withFakeHome(async ({ homeDir }) => {
      const trashFile = path.join(homeDir, ".claude", "tasks", "trash-me.json");
      const trashDir = path.join(homeDir, ".agent-remnant-cleaner", "trash");

      await writeFixture(trashFile, "trash me\n");

      const result = await applyManifest(
        {
          entries: [manifestEntry(trashFile, { action: "trash" })],
          errors: [],
        },
        { homeDir, permanent: false, trashDir },
      );

      assert.equal(result.deleted, 0);
      assert.equal(result.trashed, 1);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.errors, []);
      assert.equal(await pathExists(trashFile), false);

      const trashEntries = await readdir(trashDir, { recursive: true });
      const trashedRelativePath = trashEntries.find((entry) => path.basename(entry) === "trash-me.json");
      assert.ok(trashedRelativePath, "expected original file name under trash directory");

      const trashedPath = path.join(trashDir, trashedRelativePath);
      assert.equal(await readFile(trashedPath, "utf8"), "trash me\n");
    });
  });

  it("preserves existing trash destination and moves colliding file to a unique trash path", async () => {
    await withFakeHome(async ({ homeDir }) => {
      const originalFile = path.join(homeDir, ".claude", "tasks", "collision.json");
      const trashDir = path.join(homeDir, ".agent-remnant-cleaner", "trash");
      const absoluteOriginalFile = path.resolve(originalFile);
      const parsedOriginalFile = path.parse(absoluteOriginalFile);
      const existingTrashPath = path.join(
        trashDir,
        parsedOriginalFile.root.replace(/[^a-zA-Z0-9._-]+/g, "_") || "root",
        path.relative(parsedOriginalFile.root, absoluteOriginalFile),
      );

      await writeFixture(originalFile, "move me\n");
      await writeFixture(existingTrashPath, "already trashed\n");

      const result = await applyManifest(
        {
          entries: [manifestEntry(originalFile, { action: "trash" })],
          errors: [],
        },
        { homeDir, permanent: false, trashDir },
      );

      assert.equal(result.deleted, 0);
      assert.equal(result.trashed, 1);
      assert.equal(result.skipped, 0);
      assert.deepEqual(result.errors, []);
      assert.equal(await pathExists(originalFile), false);
      assert.equal(await readFile(existingTrashPath, "utf8"), "already trashed\n");

      const movedTrashPaths = [];
      const trashEntries = await readdir(trashDir, { recursive: true });
      for (const entry of trashEntries) {
        const candidatePath = path.join(trashDir, entry);
        if (candidatePath === existingTrashPath) {
          continue;
        }

        try {
          if ((await readFile(candidatePath, "utf8")) === "move me\n") {
            movedTrashPaths.push(candidatePath);
          }
        } catch (error) {
          if (error?.code !== "EISDIR") {
            throw error;
          }
        }
      }

      assert.equal(movedTrashPaths.length, 1, "expected moved file contents at one unique trash path");
      assert.equal(path.relative(trashDir, movedTrashPaths[0]).startsWith(".."), false);
      assert.equal(path.isAbsolute(path.relative(trashDir, movedTrashPaths[0])), false);
    });
  });
});
