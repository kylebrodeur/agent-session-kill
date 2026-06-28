import { decorateEntry } from "./format.js";

const DEFAULT_PAGE_SIZE = 20;
const INTENT_NONE = "none";

function normalizeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function reclaimableSize(row) {
  return row.selectable ? normalizeNumber(row.sizeBytes) : 0;
}

function totalSize(row) {
  return normalizeNumber(row.sizeBytes);
}

function matchesFilter(row, filter) {
  if (!filter) return true;

  const haystack = `${row.tool ?? ""} ${row.category ?? ""} ${row.path ?? ""}`.toLowerCase();
  return haystack.includes(filter);
}

function compareRows(a, b) {
  return (
    reclaimableSize(b) - reclaimableSize(a) ||
    totalSize(b) - totalSize(a) ||
    String(a.path ?? "").localeCompare(String(b.path ?? ""))
  );
}

function clampCursor(state) {
  const max = Math.max(0, visibleRows(state).length - 1);
  const nextCursor = Math.min(Math.max(0, state.cursor), max);
  if (nextCursor === state.cursor) return state;
  return { ...state, cursor: nextCursor };
}

export function createTuiState(entries) {
  return {
    entries: Array.isArray(entries) ? entries.map(decorateEntry) : [],
    cursor: 0,
    selected: new Set(),
    filter: "",
    intent: INTENT_NONE,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

export function visibleRows(state) {
  const filter = String(state.filter ?? "").trim().toLowerCase();

  return state.entries.filter((row) => matchesFilter(row, filter)).slice().sort(compareRows);
}

export function selectedRows(state) {
  return state.entries.filter((row) => row.selectable && state.selected.has(row.path));
}

export function handleTuiKey(state, key = {}) {
  const rows = visibleRows(state);
  const current = rows[state.cursor];
  const name = key.name;
  let next = { ...state, intent: INTENT_NONE };

  if (name === "up" || name === "k") {
    next.cursor -= 1;
  } else if (name === "down" || name === "j") {
    next.cursor += 1;
  } else if (name === "pageup" || (key.ctrl && name === "u")) {
    next.cursor -= state.pageSize;
  } else if (name === "pagedown" || (key.ctrl && name === "d")) {
    next.cursor += state.pageSize;
  } else if (name === "home") {
    next.cursor = 0;
  } else if (name === "end") {
    next.cursor = rows.length - 1;
  } else if ((name === "space" || key.sequence === " ") && current?.selectable) {
    const selected = new Set(state.selected);

    if (selected.has(current.path)) {
      selected.delete(current.path);
    } else {
      selected.add(current.path);
    }

    next.selected = selected;
  } else if (name === "a") {
    const visibleSelectable = rows.filter((row) => row.selectable);
    const allSelected = visibleSelectable.length > 0 && visibleSelectable.every((row) => state.selected.has(row.path));
    const selected = new Set(state.selected);

    for (const row of visibleSelectable) {
      if (allSelected) {
        selected.delete(row.path);
      } else {
        selected.add(row.path);
      }
    }

    next.selected = selected;
  } else if (name === "d" || name === "delete") {
    next.intent = "delete-selected";
  } else if (name === "r") {
    next.intent = "rescan";
  } else if (name === "o") {
    next.intent = "open-current";
  } else if (name === "q" || name === "escape") {
    next.intent = "quit";
  }

  return clampCursor(next);
}
