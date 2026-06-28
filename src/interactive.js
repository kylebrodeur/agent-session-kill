import process from "node:process";
import readline from "node:readline";
import chalk from "chalk";
import { scanRemnants } from "./scanner.js";
import { applyManifest } from "./apply.js";
import { createTuiState, handleTuiKey, selectedRows, visibleRows } from "./tui-state.js";

function formatBytes(value) {
  const size = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / (1024 ** 2)).toFixed(1)} MB`;
  return `${(size / (1024 ** 3)).toFixed(1)} GB`;
}

function colorAction(action) {
  if (action === "delete") return chalk.red(action);
  if (action === "trash") return chalk.yellow(action);
  if (action === "delegate") return chalk.cyan(action);
  return chalk.dim(action);
}

function colorRisk(risk) {
  if (risk === "protected") return chalk.red(risk);
  if (risk === "cache") return chalk.yellow(risk);
  if (risk === "delegate") return chalk.cyan(risk);
  return chalk.dim(risk);
}

function renderRow(row, active, selected) {
  const pointer = active ? chalk.cyan("›") : " ";
  const marker = selected ? chalk.green("●") : row.selectable ? "○" : "·";
  const tool = String(row.tool ?? "").padEnd(6);
  const category = String(row.category ?? "").padEnd(16);
  const actionText = colorAction(String(row.action ?? "")).padEnd(8);
  const size = formatBytes(row.sizeBytes).padStart(9);
  const risk = colorRisk(String(row.risk ?? "none")).padEnd(9);
  const line = `${pointer} ${marker} ${tool} ${category} ${actionText} ${size} ${risk} ${row.path ?? ""}`;

  return row.selectable ? line : chalk.dim(line);
}

function render(state, io) {
  const rows = visibleRows(state);
  const windowSize = 20;
  const start = Math.max(0, Math.min(state.cursor - Math.floor(windowSize / 2), Math.max(0, rows.length - windowSize)));
  const end = Math.min(rows.length, start + windowSize);

  io.stdout.write("\x1b[2J\x1b[H");
  io.stdout.write(`${chalk.bold("Agent Session Kill")}\n`);
  io.stdout.write(`${chalk.dim("↑/↓ j/k move · space toggle · a all · d/delete apply selected · r rescan · q/esc quit")}\n\n`);

  if (rows.length === 0) {
    io.stdout.write(`${chalk.dim("No rows match the current filter.")}\n`);
  } else {
    for (let index = start; index < end; index += 1) {
      const row = rows[index];
      io.stdout.write(`${renderRow(row, index === state.cursor, state.selected.has(row.path))}\n`);
    }
  }

  io.stdout.write(`\nSelected: ${selectedRows(state).length} / ${rows.filter((row) => row.selectable).length}\n`);
}

async function confirmDelete(rows, io) {
  io.stdout.write("\nSelected paths:\n");
  for (const row of rows) {
    io.stdout.write(`- ${row.path}\n`);
  }
  io.stdout.write("Type delete to confirm: ");

  return await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: io.stdin,
      output: io.stdout,
      terminal: Boolean(io.stdin?.isTTY && io.stdout?.isTTY),
    });

    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "delete");
    });
  });
}

function asScanOptions(options) {
  return {
    homeDir: options.homeDir,
    tempDir: options.tempDir,
    nowMs: Date.now(),
    olderThanMs: options.olderThanMs,
    includeCache: options.includeCache,
    apply: false,
    permanent: options.permanent,
    tools: options.tools,
  };
}

function maybeSetRawMode(input, value) {
  if (input?.isTTY && typeof input.setRawMode === "function") {
    input.setRawMode(value);
    return true;
  }

  return false;
}

export async function runInteractive(
  options,
  io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
) {
  const streams = {
    stdin: io.stdin ?? process.stdin,
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
  };

  let scan = await scanRemnants(asScanOptions(options));
  let state = createTuiState(scan.entries);

  let rawModeEnabled = false;
  let busy = false;

  try {
    readline.emitKeypressEvents(streams.stdin);
    if (typeof streams.stdin.resume === "function") {
      streams.stdin.resume();
    }

    rawModeEnabled = maybeSetRawMode(streams.stdin, true);
    render(state, streams);
  } catch (error) {
    if (rawModeEnabled) {
      maybeSetRawMode(streams.stdin, false);
    }
    throw error;
  }

  return await new Promise((resolve) => {
    const finish = (code) => {
      if (rawModeEnabled) {
        maybeSetRawMode(streams.stdin, false);
      }
      streams.stdin.off("keypress", onKeypress);
      resolve(code);
    };

    const onKeypress = async (_chunk, key = {}) => {
      if (busy) return;
      busy = true;

      try {
        state = handleTuiKey(state, key);

        if (state.intent === "quit") {
          finish(0);
          return;
        }

        if (state.intent === "rescan") {
          scan = await scanRemnants(asScanOptions(options));
          state = createTuiState(scan.entries);
          render(state, streams);
          return;
        }

        if (state.intent === "delete-selected") {
          const rows = selectedRows(state);
          if (rows.length === 0) {
            render(state, streams);
            return;
          }

          if (rawModeEnabled) {
            maybeSetRawMode(streams.stdin, false);
            rawModeEnabled = false;
          }

          const confirmed = await confirmDelete(rows, streams);
          if (!confirmed) {
            rawModeEnabled = maybeSetRawMode(streams.stdin, true);
            state = { ...state, intent: "none" };
            render(state, streams);
            return;
          }

          const applyResult = await applyManifest({ entries: rows, errors: [] }, {
            homeDir: options.homeDir,
            permanent: options.permanent,
          });

          if (applyResult.errors.length > 0) {
            for (const error of applyResult.errors) {
              streams.stderr.write(`${error}\n`);
            }
            finish(1);
            return;
          }

          finish(0);
          return;
        }

        render(state, streams);
      } catch (error) {
        streams.stderr.write(`${error.message}\n`);
        finish(1);
      } finally {
        busy = false;
      }
    };

    streams.stdin.on("keypress", onKeypress);
  });
}
