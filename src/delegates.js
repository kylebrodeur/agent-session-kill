import { spawnSync } from "node:child_process";

function resolveHomeDir(input) {
  return typeof input === "string" ? input : input?.homeDir;
}

export function buildDelegateDryRunCommands(homeDir) {
  const resolvedHomeDir = resolveHomeDir(homeDir);
  if (!resolvedHomeDir) {
    throw new Error("homeDir is required");
  }

  return [
    ["claude", "project", "purge", resolvedHomeDir, "--dry-run"],
    ["omp", "worktree", "clear", "--dry-run"],
  ];
}

export function runDelegateDryRuns(homeDir) {
  return buildDelegateDryRunCommands(homeDir).map(([command, ...args]) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    return {
      command: [command, ...args],
      status: result.status,
      signal: result.signal,
      error: result.error,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  });
}
