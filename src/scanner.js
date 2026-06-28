import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { isOlderThan } from "./age.js";
import { classifyPath, isProtectedPath } from "./protection.js";

function buildRoots(options) {
  const homeDir = path.resolve(options.homeDir);
  const tempDir = path.resolve(options.tempDir);
  const claudeDir = path.join(homeDir, ".claude");
  const piAgentDir = path.join(homeDir, ".pi", "agent");
  const ompDir = path.join(homeDir, ".omp");
  const ompAgentDir = path.join(ompDir, "agent");

  return {
    homeDir,
    tempDir,
    claudeDir,
    piAgentDir,
    ompDir,
    ompAgentDir,
  };
}

function selected(options, tool) {
  return !options.tools || options.tools.has(tool);
}

function staticCandidates(options, roots) {
  const candidates = [];

  if (selected(options, "claude")) {
    for (const category of ["session-env", "tasks", "todos", "plans", "debug", "cache", "paste-cache", "shell-snapshots", "backups"]) {
      candidates.push({ tool: "claude", category, root: path.join(roots.claudeDir, category) });
    }
  }

  if (selected(options, "pi")) {
    candidates.push(
      { tool: "pi", category: "sessions", root: path.join(roots.piAgentDir, "sessions") },
      { tool: "pi", category: "tmp", root: path.join(roots.piAgentDir, "tmp") },
      { tool: "pi", category: "session-search-index", root: path.join(roots.homeDir, ".pi", "session-search", "index") },
      { tool: "pi", category: "cache", root: path.join(roots.piAgentDir, "cache") },
    );
  }

  if (selected(options, "omp")) {
    candidates.push(
      { tool: "omp", category: "sessions", root: path.join(roots.ompAgentDir, "sessions") },
      { tool: "omp", category: "terminal-sessions", root: path.join(roots.ompAgentDir, "terminal-sessions") },
      { tool: "omp", category: "logs", root: path.join(roots.ompDir, "logs") },
      { tool: "omp", category: "blobs", root: path.join(roots.ompAgentDir, "blobs") },
      { tool: "omp", category: "cache", root: path.join(roots.ompDir, "cache") },
      { tool: "omp", category: "cache", root: path.join(roots.ompAgentDir, "cache") },
    );
  }

  return candidates;
}

async function tempCandidates(options, roots, errors) {
  if (!selected(options, "temp")) {
    return [];
  }

  let dirents;
  try {
    dirents = await readdir(roots.tempDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      errors.push(`Failed to read ${roots.tempDir}: ${error.message}`);
    }
    return [];
  }

  const candidates = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.isSymbolicLink() || !dirent.name.startsWith("pi-subagents-")) {
      continue;
    }

    const root = path.join(roots.tempDir, dirent.name);
    candidates.push(
      { tool: "temp", category: "pi-subagents-chain", root: path.join(root, "chain-runs") },
      { tool: "temp", category: "pi-subagents-async", root: path.join(root, "async-subagent-runs") },
    );
  }

  return candidates;
}

function reasonFor({ cacheOptOut, protectedPath, oldEnough }) {
  if (cacheOptOut) {
    return "cache cleanup opt-out";
  }

  if (protectedPath) {
    return "protected path";
  }

  if (!oldEnough) {
    return "younger than threshold";
  }

  return "older than threshold";
}

function entryFor(filePath, stats, candidate, roots, options) {
  const classification = classifyPath(filePath, roots, options.includeCache);
  const cacheOptOut = classification.cache && !options.includeCache;
  const protectedPath = classification.protected || isProtectedPath(filePath, roots);
  const oldEnough = isOlderThan(stats.mtimeMs, options.nowMs, options.olderThanMs);
  const action = protectedPath || cacheOptOut || !oldEnough ? "keep" : options.permanent ? "delete" : "trash";

  return {
    tool: candidate.tool,
    category: classification.category === "unknown" ? candidate.category : classification.category,
    path: filePath,
    type: "file",
    sizeBytes: stats.size,
    modifiedMs: stats.mtimeMs,
    action,
    reason: reasonFor({ cacheOptOut, protectedPath, oldEnough }),
    protected: protectedPath,
  };
}

async function walkCandidate(candidate, roots, options, entries, errors) {
  let stats;
  try {
    stats = await lstat(candidate.root);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      errors.push(`Failed to stat ${candidate.root}: ${error.message}`);
    }
    return;
  }

  if (stats.isSymbolicLink()) {
    return;
  }

  if (stats.isFile()) {
    entries.push(entryFor(candidate.root, stats, candidate, roots, options));
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  await walkDirectory(candidate.root, candidate, roots, options, entries, errors);
}

async function walkDirectory(directory, candidate, roots, options, entries, errors) {
  let dirents;
  try {
    dirents = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    errors.push(`Failed to read ${directory}: ${error.message}`);
    return;
  }

  dirents.sort((a, b) => a.name.localeCompare(b.name));

  for (const dirent of dirents) {
    const childPath = path.join(directory, dirent.name);

    if (dirent.isSymbolicLink()) {
      continue;
    }

    if (dirent.isDirectory()) {
      await walkDirectory(childPath, candidate, roots, options, entries, errors);
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    let stats;
    try {
      stats = await lstat(childPath);
    } catch (error) {
      errors.push(`Failed to stat ${childPath}: ${error.message}`);
      continue;
    }

    if (!stats.isSymbolicLink() && stats.isFile()) {
      entries.push(entryFor(childPath, stats, candidate, roots, options));
    }
  }
}

export async function scanRemnants(options) {
  const roots = buildRoots(options);
  const errors = [];
  const entries = [];
  const candidates = [
    ...staticCandidates(options, roots),
    ...(await tempCandidates(options, roots, errors)),
  ];

  for (const candidate of candidates) {
    await walkCandidate(candidate, roots, options, entries, errors);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  const result = { entries, errors };
  Object.defineProperty(result, "find", {
    value: entries.find.bind(entries),
    enumerable: false,
  });

  return result;
}
