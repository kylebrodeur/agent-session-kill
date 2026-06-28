import chalk from "chalk";

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;]*m/g;

function normalizeResults(input) {
  if (Array.isArray(input)) {
    return { entries: input, errors: [] };
  }

  return {
    entries: Array.isArray(input?.entries) ? input.entries : [],
    errors: Array.isArray(input?.errors) ? input.errors : [],
  };
}

export function decorateEntry(entry) {
  const protectedRow = Boolean(entry.protected);
  const cacheRisk = entry.category === "cache";
  const delegateRisk = entry.action === "delegate";
  const risk = protectedRow ? "protected" : delegateRisk ? "delegate" : cacheRisk ? "cache" : "none";

  return {
    ...entry,
    selectable: !protectedRow && (entry.action === "trash" || entry.action === "delete"),
    risk,
  };
}

export function decorateResults(input) {
  const results = normalizeResults(input);
  return { ...results, entries: results.entries.map(decorateEntry) };
}

function colorAction(value, color) {
  if (!color) return value;
  if (value === "trash") return chalk.yellow(value);
  if (value === "delete") return chalk.red(value);
  if (value === "keep") return chalk.dim(value);
  if (value === "delegate") return chalk.cyan(value);
  return value;
}

function colorRisk(value, color) {
  if (!color) return value;
  if (value === "protected") return chalk.red(value);
  if (value === "delegate") return chalk.cyan(value);
  if (value === "cache") return chalk.yellow(value);
  if (value === "none") return chalk.dim(value);
  return value;
}

function valueFor(entry, column, color) {
  if (column.key === "modified") {
    return Number.isFinite(entry.modifiedMs) ? new Date(entry.modifiedMs).toISOString() : "";
  }

  if (column.key === "action") {
    return colorAction(String(entry.action ?? ""), color);
  }

  if (column.key === "risk") {
    return colorRisk(String(entry.risk ?? ""), color);
  }

  const value = entry[column.key];
  return value === undefined || value === null ? "" : String(value);
}

function visibleLength(value) {
  return value.replace(ANSI_ESCAPE_PATTERN, "").length;
}

export function formatTable(input, { color } = {}) {
  const results = decorateResults(input);
  const useColor = color !== false;
  const columns = [
    { key: "tool", label: "Tool" },
    { key: "category", label: "Category" },
    { key: "action", label: "Action" },
    { key: "risk", label: "Risk" },
    { key: "sizeBytes", label: "Bytes" },
    { key: "modified", label: "Modified" },
    { key: "path", label: "Path" },
    { key: "reason", label: "Reason" },
  ];

  const rows = results.entries.map((entry) => columns.map((column) => valueFor(entry, column, useColor)));
  const widths = columns.map((column, index) =>
    Math.max(column.label.length, ...rows.map((row) => visibleLength(row[index]))),
  );

  const renderRow = (cells) =>
    cells
      .map((cell, index) => `${cell}${" ".repeat(Math.max(0, widths[index] - visibleLength(cell)))}`)
      .join("  ")
      .trimEnd();

  const lines = [
    renderRow(columns.map((column) => column.label)),
    renderRow(widths.map((width) => "-".repeat(width))),
    ...rows.map(renderRow),
  ];

  if (results.errors.length > 0) {
    lines.push("", "Errors:", ...results.errors.map((error) => `- ${error}`));
  }

  return lines.join("\n");
}

export function formatJson(entries) {
  return `${JSON.stringify(normalizeResults(entries), null, 2)}\n`;
}

