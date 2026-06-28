import path from "node:path";

const PROTECTED_ROOT_NAMES = new Set([
  "plugins",
  "skills",
  "agents",
  "commands",
  "managed-skills",
  "memories",
  "model",
  "models",
  "mcp",
  "npm",
  "projects",
]);

const PROTECTED_FILE_PATTERNS = [
  /^api\b/i,
  /^auth\b/i,
  /^settings\b/i,
  /^config\b/i,
  /^model(s)?\b/i,
  /^mcp\b/i,
];

function absolute(input) {
  return path.resolve(input);
}

function isInside(candidate, root) {
  if (!root) {
    return false;
  }

  const relative = path.relative(absolute(root), absolute(candidate));
  return relative === "" || (relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function firstSegment(candidate, root) {
  if (!isInside(candidate, root)) {
    return undefined;
  }

  const relative = path.relative(absolute(root), absolute(candidate));
  return relative.split(path.sep)[0];
}

function basename(candidate) {
  return path.basename(absolute(candidate));
}

function matchesProtectedFile(candidate) {
  const name = basename(candidate);
  return PROTECTED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function isProtectedUnderRoot(candidate, root) {
  const segment = firstSegment(candidate, root);
  if (!segment) {
    return false;
  }

  return PROTECTED_ROOT_NAMES.has(segment) || matchesProtectedFile(candidate);
}

function classifyRemnant(candidate, roots) {
  const remnantRoots = [
    [roots.claudeDir, "session-env", "session-env"],
    [roots.claudeDir, "tasks", "tasks"],
    [roots.claudeDir, "todos", "todos"],
    [roots.piAgentDir, "sessions", "sessions"],
    [roots.ompAgentDir, "sessions", "sessions"],
  ];

  for (const [root, segment, category] of remnantRoots) {
    if (isInside(candidate, path.join(root, segment))) {
      return category;
    }
  }

  if (isPiSubagentsAsync(candidate, roots.tempDir)) {
    return "pi-subagents-async";
  }

  return undefined;
}

function isPiSubagentsAsync(candidate, tempDir) {
  if (!isInside(candidate, tempDir)) {
    return false;
  }

  const relative = path.relative(absolute(tempDir), absolute(candidate));
  const parts = relative.split(path.sep);
  return parts[0]?.startsWith("pi-subagents-") && parts[1] === "async-subagent-runs";
}

function isCachePath(candidate, roots) {
  return [
    path.join(roots.claudeDir, "cache"),
    path.join(roots.piAgentDir, "cache"),
    path.join(roots.ompDir, "cache"),
    path.join(roots.ompAgentDir, "cache"),
    path.join(roots.copilotChatDir, "commandEmbeddings.json"),
    path.join(roots.copilotChatDir, "settingEmbeddings.json"),
    path.join(roots.copilotChatDir, "toolEmbeddingsCache.bin"),
    path.join(roots.copilotChatDir, "copilot-cli-images"),
  ].some((root) => isInside(candidate, root));
}

export function isProtectedPath(candidate, roots) {
  if (absolute(candidate) === path.join(absolute(roots.homeDir), ".claude.json")) {
    return true;
  }

  if (classifyRemnant(candidate, roots)) {
    return false;
  }

  if (isInside(candidate, roots.copilotChatDir)) {
    const absCandidate = absolute(candidate);
    const absBase = absolute(roots.copilotChatDir);
    if (absCandidate === path.join(absBase, "debugCommand")) return true;
    if (absCandidate === path.join(absBase, "mcpServers.json")) return true;
    return isProtectedUnderRoot(candidate, roots.copilotChatDir);
  }

  return [roots.claudeDir, roots.piAgentDir, roots.ompAgentDir].some((root) => isProtectedUnderRoot(candidate, root));
}

export function classifyPath(candidate, roots, includeCache) {
  const remnantCategory = classifyRemnant(candidate, roots);
  if (remnantCategory) {
    return {
      category: remnantCategory,
      cache: false,
      protected: false,
    };
  }

  if (isCachePath(candidate, roots)) {
    return {
      category: "cache",
      cache: true,
      protected: !includeCache,
    };
  }

  return {
    category: "unknown",
    cache: false,
    protected: isProtectedPath(candidate, roots),
  };
}
