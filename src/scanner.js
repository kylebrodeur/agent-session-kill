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
  const copilotChatDir =
    process.platform === "darwin"
      ? path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "github.copilot-chat")
      : path.join(homeDir, ".config", "Code", "User", "globalStorage", "github.copilot-chat");

  return {
    homeDir,
    tempDir,
    claudeDir,
    piAgentDir,
    ompDir,
    ompAgentDir,
    copilotChatDir,
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

  if (selected(options, "copilot")) {
    for (const [dirName, category] of [
      ["ask-agent", "ask-agent"],
      ["plan-agent", "plan-agent"],
      ["explore-agent", "explore-agent"],
      ["logContextRecordings", "log-context"],
      ["memory-tool", "memory"],
    ]) {
      candidates.push({ tool: "copilot", category, root: path.join(roots.copilotChatDir, dirName) });
    }
    candidates.push({ tool: "copilot", category: "sessions", root: path.join(roots.copilotChatDir, "copilot.cli.oldGlobalSessions.json") });
    for (const name of ["commandEmbeddings.json", "settingEmbeddings.json", "toolEmbeddingsCache.bin"]) {
      candidates.push({ tool: "copilot", category: "cache", root: path.join(roots.copilotChatDir, name) });
    }
    candidates.push({ tool: "copilot", category: "cache", root: path.join(roots.copilotChatDir, "copilot-cli-images") });
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

async function copilotWorkspaceSessionCandidates(options, roots, errors) {
  if (!selected(options, "copilot")) return [];
  let dirents;
  try {
    dirents = await readdir(roots.copilotChatDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") errors.push(`Failed to read ${roots.copilotChatDir}: ${error.message}`);
    return [];
  }
  return dirents
    .filter(d => d.isFile() && d.name.startsWith("copilot.cli.workspaceSessions"))
    .map(d => ({ tool: "copilot", category: "workspace-sessions", root: path.join(roots.copilotChatDir, d.name) }));
}

async function buildWorkspaceProjectIndex(workspaceDir, homeDir) {
  const known = new Set();
  known.add(workspaceDir.slice(homeDir.length).replace(/\//g, "-"));

  let topDirents;
  try {
    topDirents = await readdir(workspaceDir, { withFileTypes: true });
  } catch { return known; }

  for (const dirent of topDirents) {
    if (!dirent.isDirectory() || dirent.isSymbolicLink()) continue;
    const p = path.join(workspaceDir, dirent.name);
    known.add(p.slice(homeDir.length).replace(/\//g, "-"));
    try {
      const sub = await readdir(p, { withFileTypes: true });
      for (const s of sub) {
        if (!s.isDirectory() || s.isSymbolicLink()) continue;
        const sp = path.join(p, s.name);
        known.add(sp.slice(homeDir.length).replace(/\//g, "-"));
      }
    } catch {}
  }
  return known;
}

async function findOrphanedOmpSessionDirs(roots, workspaceDir, errors) {
  const orphaned = new Set();
  const sessionsRoot = path.join(roots.ompAgentDir, "sessions");
  let dirents;
  try {
    dirents = await readdir(sessionsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") errors.push(`Failed to read ${sessionsRoot}: ${error.message}`);
    return orphaned;
  }

  const workspaceEncoded = workspaceDir.slice(roots.homeDir.length).replace(/\//g, "-");
  const prefix = workspaceEncoded + "-";
  const known = await buildWorkspaceProjectIndex(workspaceDir, roots.homeDir);

  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.isSymbolicLink()) continue;
    const name = dirent.name;
    if (name !== workspaceEncoded && !name.startsWith(prefix)) continue;
    if (name === prefix) continue;
    if (!known.has(name)) {
      orphaned.add(path.join(sessionsRoot, name));
    }
  }
  return orphaned;
}


function reasonFor({ cacheOptOut, protectedPath, oldEnough, isOrphaned }) {
  if (cacheOptOut) {
    return "cache cleanup opt-out";
  }

  if (protectedPath) {
    return "protected path";
  }

  if (isOrphaned) {
    return "orphaned session";
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
  const isOrphaned = (options.orphanedDirs?.size ?? 0) > 0 &&
    [...options.orphanedDirs].some(dir => filePath.startsWith(dir + path.sep));
  const effectivelyOld = isOrphaned || oldEnough;
  const action = protectedPath || cacheOptOut || !effectivelyOld ? "keep" : options.permanent ? "delete" : "trash";

  return {
    tool: candidate.tool,
    category: classification.category === "unknown" ? candidate.category : classification.category,
    path: filePath,
    type: "file",
    sizeBytes: stats.size,
    modifiedMs: stats.mtimeMs,
    action,
    reason: reasonFor({ cacheOptOut, protectedPath, oldEnough, isOrphaned }),
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

  const orphanedDirs = options.workspaceDir
    ? await findOrphanedOmpSessionDirs(roots, options.workspaceDir, errors)
    : new Set();

  const effectiveOptions = { ...options, orphanedDirs };

  const candidates = [
    ...staticCandidates(effectiveOptions, roots),
    ...(await tempCandidates(effectiveOptions, roots, errors)),
    ...(await copilotWorkspaceSessionCandidates(effectiveOptions, roots, errors)),
  ];

  for (const candidate of candidates) {
    await walkCandidate(candidate, roots, effectiveOptions, entries, errors);
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  const result = { entries, errors };
  Object.defineProperty(result, "find", {
    value: entries.find.bind(entries),
    enumerable: false,
  });

  return result;
}
