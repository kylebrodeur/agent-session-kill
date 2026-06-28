#!/usr/bin/env node
import os from "node:os";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { parseDurationMs } from "./age.js";
import { runDelegateDryRuns } from "./delegates.js";
import { formatJson, formatTable } from "./format.js";
import { scanRemnants } from "./scanner.js";
import { applyManifest } from "./apply.js";
import { runInteractive } from "./interactive.js";
const TOOLS = new Set(["claude", "pi", "omp", "temp"]);

function usage() {
  return buildProgram().helpInformation().trimEnd();
}

function collectTools(value, previous) {
  const collected = [...previous];
  for (const tool of value.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (!TOOLS.has(tool)) {
      throw new Error(`Unknown tool: ${tool}`);
    }
    collected.push(tool);
  }
  return collected;
}

function buildDefaultOptions() {
  return {
    olderThan: "14d",
    includeCache: false,
    apply: false,
    permanent: false,
    json: false,
    delegates: false,
    homeDir: os.homedir(),
    tempDir: os.tmpdir(),
    dryRun: false,
    tools: new Set(TOOLS),
  };
}

function toCliArgs(command, options) {
  return { command, options };
}

export function buildProgram() {
  const program = new Command();
  const selectCommand = (name) => () => {
    program.selectedCommand = name;
  };

  program
    .name("agent-session-kill")
    .description("NPKILL-style cleanup for Claude, Pi, and OMP agent session remnants")
    .exitOverride()
    .allowExcessArguments(false)
    .option("--older-than <duration>", "minimum age to consider stale", "14d")
    .option("--tool <name>", "limit to claude, pi, omp, or temp; repeat or comma-separate", collectTools, [])
    .option("--include-cache", "include cache roots in cleanup candidates", false)
    .option("--json", "print JSON instead of a table", false)
    .option("--delegates", "run delegate dry-run cleanup commands", false)
    .option("--home <path>", "home directory to scan", os.homedir())
    .option("--temp <path>", "temp directory to scan", os.tmpdir())
    .option("--dry-run", "force dry-run mode", false)
    .option("--permanent", "permanently delete instead of trash", false);

  program.command("interactive", { isDefault: true }).description("open the interactive picker").action(selectCommand("interactive"));
  program.command("scan").description("print a non-interactive inventory").action(selectCommand("scan"));
  program
    .command("clean")
    .description("print cleanup manifest and optionally apply")
    .option("--apply", "apply cleanup changes", false)
    .action(selectCommand("clean"));

  return program;
}

export function parseCliArgs(argv) {
  const program = buildProgram();
  const defaults = buildDefaultOptions();

  program.configureOutput({
    writeOut() {},
    writeErr() {},
    outputError() {},
  });

  try {
    program.parse(argv, { from: "user" });
  } catch (error) {
    if (error?.code === "commander.helpDisplayed") {
      return toCliArgs("interactive", { ...defaults, help: true });
    }
    throw new Error(error.message);
  }

  const parsed = program.opts();
  const cleanCommand = program.commands.find((command) => command.name() === "clean");
  const cleanOptions = cleanCommand ? cleanCommand.opts() : {};
  const command = program.selectedCommand ?? "interactive";
  const options = {
    ...defaults,
    olderThan: parsed.olderThan,
    includeCache: parsed.includeCache,
    apply: command === "clean" ? Boolean(cleanOptions.apply) : false,
    permanent: parsed.permanent,
    json: parsed.json,
    delegates: parsed.delegates,
    homeDir: parsed.home,
    tempDir: parsed.temp,
    dryRun: parsed.dryRun,
    tools: parsed.tool.length > 0 ? new Set(parsed.tool) : new Set(TOOLS),
  };

  if (options.dryRun) {
    options.apply = false;
  }

  return toCliArgs(command, options);
}

function writeDelegateOutput(stderr, result) {
  if (result.stdout) {
    stderr.write(result.stdout);
  }
  if (result.stderr) {
    stderr.write(result.stderr);
  }
}

export async function main(argv = process.argv.slice(2), io = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
  const args = parseCliArgs(argv);
  const { options } = args;
  if (options.help) {
    io.stdout.write(`${usage()}\n`);
    return 0;
  }

  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;

  if (args.command === "interactive") {
    if (!stdin.isTTY || !stdout.isTTY) {
      io.stderr.write("Interactive mode requires a TTY. Use `scan`, `clean --dry-run`, or `--json` for scripts.\n");
      return 1;
    }

    return await runInteractive({
      homeDir: options.homeDir,
      tempDir: options.tempDir,
      nowMs: Date.now(),
      olderThanMs: parseDurationMs(options.olderThan),
      includeCache: options.includeCache,
      apply: false,
      permanent: options.permanent,
      tools: options.tools,
    }, {
      stdin,
      stdout,
      stderr: io.stderr,
    });
  }

  const results = await scanRemnants({
    homeDir: options.homeDir,
    tempDir: options.tempDir,
    nowMs: Date.now(),
    olderThanMs: parseDurationMs(options.olderThan),
    includeCache: options.includeCache,
    apply: options.apply,
    permanent: options.permanent,
    tools: options.tools,
  });

  if (args.command === "clean" && !options.apply) {
    io.stderr.write("Dry run only; no files were changed. Re-run with --apply when ready to cleanup.\n");
    io.stdout.write(options.json ? formatJson(results) : `${formatTable(results)}\n`);
  } else if (args.command === "clean" && options.apply) {
    io.stdout.write(options.json ? formatJson(results) : `${formatTable(results)}\n`);
    const scanErrorCount = results.errors.length;
    const applyResult = await applyManifest(results, {
      homeDir: options.homeDir,
      permanent: options.permanent,
    });
    const applyErrors = applyResult.errors.slice(scanErrorCount);
    results.errors.push(...applyErrors);
    io.stderr.write(`Applied: ${applyResult.deleted} deleted, ${applyResult.trashed} trashed, ${applyResult.skipped} skipped.\n`);
    for (const error of applyErrors) {
      io.stderr.write(`${error}\n`);
    }
  } else {
    io.stdout.write(options.json ? formatJson(results) : `${formatTable(results)}\n`);
  }

  if (args.command === "clean" && options.delegates) {
    for (const result of runDelegateDryRuns(options.homeDir)) {
      writeDelegateOutput(io.stderr, result);
    }
  }

  return results.errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n${usage()}\n`);
    process.exitCode = 1;
  });
}
