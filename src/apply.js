import { access, cp, mkdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function normalizeManifest(input) {
  if (Array.isArray(input)) {
    return { entries: input, errors: [] };
  }

  return {
    entries: Array.isArray(input?.entries) ? input.entries : [],
    errors: Array.isArray(input?.errors) ? input.errors : [],
  };
}

function defaultTrashDir(options) {
  const homeDir = options?.homeDir ? path.resolve(options.homeDir) : os.homedir();
  return path.join(homeDir, ".Trash", "agent-session-kill");
}

function trashPathFor(entry, trashDir) {
  const absolutePath = path.resolve(entry.path);
  const parsed = path.parse(absolutePath);
  const rootSegment = parsed.root.replace(/[^a-zA-Z0-9._-]+/g, "_") || "root";
  const relativePath = path.relative(parsed.root, absolutePath);

  return path.join(trashDir, rootSegment, relativePath);
}

async function pathExists(candidatePath) {
  try {
    await access(candidatePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function uniqueTrashPathFor(entry, trashDir) {
  const destination = trashPathFor(entry, trashDir);

  if (!(await pathExists(destination))) {
    return destination;
  }

  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${destination}.${suffix}`;

    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }
}

function shouldSkip(entry) {
  return entry.protected || entry.action === "keep" || entry.action === "delegate";
}

async function moveToTrash(entry, trashDir) {
  const destination = await uniqueTrashPathFor(entry, trashDir);
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    await rename(entry.path, destination);
  } catch (error) {
    if (error?.code !== "EXDEV") {
      throw error;
    }

    await cp(entry.path, destination, { recursive: true, force: false, errorOnExist: true });
    await rm(entry.path, { recursive: true, force: false });
  }
}

export async function applyManifest(input, options = {}) {
  const manifest = normalizeManifest(input);
  const result = {
    deleted: 0,
    trashed: 0,
    skipped: 0,
    errors: [...manifest.errors],
  };
  const trashDir = path.resolve(options.trashDir ?? defaultTrashDir(options));

  for (const entry of manifest.entries) {
    if (shouldSkip(entry)) {
      result.skipped += 1;
      continue;
    }

    try {
      if (options.permanent || entry.action === "delete") {
        await rm(entry.path, { recursive: true, force: false });
        result.deleted += 1;
        continue;
      }

      if (entry.action === "trash") {
        await moveToTrash(entry, trashDir);
        result.trashed += 1;
        continue;
      }

      result.skipped += 1;
    } catch (error) {
      result.errors.push(`Failed to apply ${entry.action} to ${entry.path}: ${error.message}`);
    }
  }

  return result;
}
