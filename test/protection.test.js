import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPath, isProtectedPath } from "../src/protection.js";

const roots = {
  homeDir: "/home/user",
  claudeDir: "/home/user/.claude",
  piAgentDir: "/home/user/.pi/agent",
  ompDir: "/home/user/.omp",
  ompAgentDir: "/home/user/.omp/agent",
  tempDir: "/private/tmp",
  copilotChatDir: "/home/user/Library/Application Support/Code/User/globalStorage/github.copilot-chat",
};

describe("isProtectedPath", () => {
  it("protects Claude settings, plugins, skills, and agents", () => {
    assert.equal(isProtectedPath("/home/user/.claude/settings.json", roots), true);
    assert.equal(isProtectedPath("/home/user/.claude/plugins/example/plugin.js", roots), true);
    assert.equal(isProtectedPath("/home/user/.claude/skills/example/SKILL.md", roots), true);
    assert.equal(isProtectedPath("/home/user/.claude/agents/reviewer.md", roots), true);
    assert.equal(isProtectedPath("/home/user/.claude/commands/deploy.md", roots), true);
  });

  it("protects top-level Claude config", () => {
    assert.equal(isProtectedPath("/home/user/.claude.json", roots), true);
  });

  it("protects Claude project payloads from direct cleanup", () => {
    assert.equal(isProtectedPath("/home/user/.claude/projects/proj/session.jsonl", roots), true);
  });

  it("protects Pi auth, settings, models, MCP config, and npm installs", () => {
    assert.equal(isProtectedPath("/home/user/.pi/agent/auth.json", roots), true);
    assert.equal(isProtectedPath("/home/user/.pi/agent/settings.json", roots), true);
    assert.equal(isProtectedPath("/home/user/.pi/agent/models.json", roots), true);
    assert.equal(isProtectedPath("/home/user/.pi/agent/mcp.json", roots), true);
    assert.equal(isProtectedPath("/home/user/.pi/agent/mcp-cache.json", roots), true);
    assert.equal(isProtectedPath("/home/user/.pi/agent/npm/package/index.js", roots), true);
  });

  it("protects OMP config, managed skills, and memories", () => {
    assert.equal(isProtectedPath("/home/user/.omp/agent/config.yml", roots), true);
    assert.equal(isProtectedPath("/home/user/.omp/agent/managed-skills/example/SKILL.md", roots), true);
    assert.equal(isProtectedPath("/home/user/.omp/agent/memories/memory.db", roots), true);
  });

  it("does not protect known remnant roots", () => {
    assert.equal(isProtectedPath("/home/user/.claude/session-env/run/env.json", roots), false);
    assert.equal(isProtectedPath("/home/user/.claude/tasks/task.json", roots), false);
    assert.equal(isProtectedPath("/home/user/.pi/agent/sessions/project/session.jsonl", roots), false);
    assert.equal(isProtectedPath("/home/user/.omp/agent/sessions/project/session.jsonl", roots), false);
  });

  it("protects Copilot api.json, debugCommand, and mcpServers.json", () => {
    const base = roots.copilotChatDir;
    assert.equal(isProtectedPath(`${base}/api.json`, roots), true);
    assert.equal(isProtectedPath(`${base}/debugCommand`, roots), true);
    assert.equal(isProtectedPath(`${base}/mcpServers.json`, roots), true);
  });
  it("does not protect Copilot session dirs or workspace session files", () => {
    const base = roots.copilotChatDir;
    assert.equal(isProtectedPath(`${base}/ask-agent/file.json`, roots), false);
    assert.equal(isProtectedPath(`${base}/copilot.cli.workspaceSessions.abc.json`, roots), false);
  });
});

describe("classifyPath", () => {
  it("keeps OMP cache protected unless cache cleanup is opted in", () => {
    assert.deepEqual(classifyPath("/home/user/.omp/cache/blob", roots, false), {
      category: "cache",
      cache: true,
      protected: true,
    });
    assert.deepEqual(classifyPath("/home/user/.omp/cache/blob", roots, true), {
      category: "cache",
      cache: true,
      protected: false,
    });
  });

  it("protects Claude project payloads from direct classification cleanup", () => {
    const classification = classifyPath("/home/user/.claude/projects/proj/session.jsonl", roots, false);

    assert.equal(classification.protected, true);
  });

  it("classifies Claude task remnants", () => {
    assert.deepEqual(classifyPath("/home/user/.claude/tasks/task.json", roots, false), {
      category: "tasks",
      cache: false,
      protected: false,
    });
  });

  it("classifies pi-subagents async temp roots", () => {
    assert.deepEqual(classifyPath("/private/tmp/pi-subagents-user/async-subagent-runs/run/status.json", roots, false), {
      category: "pi-subagents-async",
      cache: false,
      protected: false,
    });
    assert.deepEqual(classifyPath("/private/tmp/pi-subagents-abc123/async-subagent-runs/run/status.json", roots, false), {
      category: "pi-subagents-async",
      cache: false,
      protected: false,
    });
  });

  it("classifies Copilot cache files as cache", () => {
    const result = classifyPath(`${roots.copilotChatDir}/commandEmbeddings.json`, roots, false);
    assert.equal(result.cache, true);
    assert.equal(result.protected, true);
  });
});
