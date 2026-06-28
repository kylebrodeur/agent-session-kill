# Agent Session Kill

NPKILL-style cleanup for AI coding-agent session remnants.

`agent-session-kill` scans local Claude Code, Pi/pi-mono, Oh My Pi (OMP), GitHub Copilot Chat, and subagent temp storage, then lets you review and delete stale session artifacts from an interactive terminal UI.

## Why

Agent harnesses save transcripts, tool outputs, task state, shell snapshots, logs, temp subagent runs, and per-project session files. Those files are useful while work is active, but they pile up.

Agent Session Kill gives you a single cleanup surface with conservative defaults:

- interactive picker by default, inspired by `npkill`
- dry-run and JSON modes for scripts
- protected paths for auth, settings, plugins, skills, memory, and model config
- cache cleanup is opt-in
- trash-first deletion by default
- explicit confirmation before interactive deletion

## Install

```bash
npm install -g agent-session-kill
```

Or run without installing:

```bash
npx agent-session-kill
```

## Commands

```bash
agent-session-kill                         # interactive picker
agentkill                                  # short alias
agent-session-kill interactive             # explicit picker
agent-session-kill scan --older-than 14d   # non-interactive inventory
agent-session-kill scan --json             # machine-readable inventory
agent-session-kill clean --dry-run         # non-interactive dry run
agent-session-kill clean --apply           # apply non-interactive manifest
```

## Interactive controls

| Key | Action |
| --- | --- |
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `PgUp` / `Ctrl+u` | Page up |
| `PgDn` / `Ctrl+d` | Page down |
| `Home` / `End` | Jump to first/last row |
| `Space` | Toggle current selectable row |
| `a` | Toggle all selectable visible rows |
| `d` / `Del` | Delete selected rows after confirmation |
| `r` | Rescan |
| `q` / `Esc` | Quit without changes |

Rows that are protected or kept are visible but not selectable.

## Options

| Option | Description | Default |
| --- | --- | --- |
| `--older-than <duration>` | Minimum age for stale artifacts. Supports `m`, `h`, `d`. | `14d` |
| `--tool <name>` | Limit to `claude`, `pi`, `omp`, `temp`, or `copilot`. Repeat or comma-separate. | all |
| `--include-cache` | Include cache roots as cleanup candidates. | off |
| `--json` | Print JSON. Always non-interactive. | off |
| `--delegates` | Run delegated dry-runs (`claude project purge`, `omp worktree clear`). | off |
| `--home <path>` | Home directory to scan. | current user home |
| `--temp <path>` | Temp directory to scan. | OS temp dir |
| `--workspace <path>` | Workspace directory; OMP sessions for projects no longer on disk are flagged as orphaned and trashed regardless of age (scans 2 levels deep). | off |
| `--dry-run` | Force dry-run mode. | off |
| `--apply` | Apply cleanup in `clean` mode. | off |
| `--permanent` | Permanently delete instead of trashing. | off |

## What it scans

### Claude Code

- `~/.claude/session-env/`
- `~/.claude/tasks/`
- `~/.claude/plans/`
- `~/.claude/debug/`
- `~/.claude/paste-cache/`
- `~/.claude/shell-snapshots/`
- `~/.claude/backups/`
- `~/.claude/cache/` only when `--include-cache` is set

Claude project transcripts under `~/.claude/projects/` are protected from direct deletion. Use `--delegates` to preview the official `claude project purge` path.

### Pi / pi-mono

- `~/.pi/agent/sessions/`
- `~/.pi/agent/tmp/`
- `~/.pi/session-search/index/`
- `~/.pi/agent/cache/` only when `--include-cache` is set

### OMP / Oh My Pi

- `~/.omp/agent/sessions/`
- `~/.omp/agent/terminal-sessions/`
- `~/.omp/logs/`
- `~/.omp/agent/blobs/`
- `~/.omp/agent/cache/` only when `--include-cache` is set
- `~/.omp/cache/` only when `--include-cache` is set

OMP worktrees are handled through `omp worktree clear --dry-run` when delegates are enabled.

### GitHub Copilot Chat (VS Code)

- `ask-agent/`, `plan-agent/`, `explore-agent/`, `logContextRecordings/`, `memory-tool/`
- `copilot.cli.oldGlobalSessions.json`
- `copilot.cli.workspaceSessions.*.json`
- `commandEmbeddings.json`, `settingEmbeddings.json`, `toolEmbeddingsCache.bin`, `copilot-cli-images/` only when `--include-cache` is set

macOS path: `~/Library/Application Support/Code/User/globalStorage/github.copilot-chat`
Linux path: `~/.config/Code/User/globalStorage/github.copilot-chat`

### Subagent temp runs

- `<temp>/pi-subagents-*/chain-runs/`
- `<temp>/pi-subagents-*/async-subagent-runs/`

## Protected paths

Agent Session Kill never deletes known auth, settings, plugin, skill, memory, model, or MCP configuration paths, even when broad options are used.

Examples:

- `~/.claude.json`
- `~/.claude/settings.json`
- `~/.claude/plugins/`
- `~/.claude/skills/`
- `~/.claude/agents/`
- `~/.claude/commands/`
- `~/.claude/projects/`
- `~/.pi/agent/auth.json`
- `~/.pi/agent/settings.json`
- `~/.pi/agent/models.json`
- `~/.pi/agent/mcp*.json`
- `~/.pi/agent/npm/`
- `~/.omp/agent/config.yml`
- `~/.omp/agent/managed-skills/`
- `~/.omp/agent/memories/`
- `~/.../github.copilot-chat/api.json`
- `~/.../github.copilot-chat/mcpServers.json`
- `~/.../github.copilot-chat/debugCommand`

## Safety model

- Interactive mode requires a TTY.
- Script output uses `scan`, `clean --dry-run`, or `--json`.
- `clean` is dry-run unless `--apply` is present.
- `--dry-run` overrides `--apply` if both are supplied.
- Cache cleanup requires `--include-cache`.
- Permanent deletion requires `--permanent`.
- Interactive deletion requires typing `delete` after selected paths are printed.

## Development

```bash
npm install
npm test
```

Run local smoke checks:

```bash
node src/cli.js scan --tool claude
node src/cli.js clean --dry-run --tool claude
node src/cli.js scan --json --tool claude
```

## License

MIT
