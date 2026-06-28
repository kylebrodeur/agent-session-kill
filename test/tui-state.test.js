import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiState, handleTuiKey, selectedRows, visibleRows } from "../src/tui-state.js";

const rows = [
  {
    path: "/a",
    action: "trash",
    protected: false,
    category: "tasks",
    tool: "claude",
    sizeBytes: 100,
    modifiedMs: 1,
    reason: "old",
  },
  {
    path: "/b",
    action: "keep",
    protected: false,
    category: "cache",
    tool: "omp",
    sizeBytes: 200,
    modifiedMs: 1,
    reason: "cache opt-out",
  },
  {
    path: "/c",
    action: "trash",
    protected: true,
    category: "projects",
    tool: "claude",
    sizeBytes: 300,
    modifiedMs: 1,
    reason: "protected",
  },
  {
    path: "/d",
    action: "trash",
    protected: false,
    category: "sessions",
    tool: "pi",
    sizeBytes: 400,
    modifiedMs: 1,
    reason: "old",
  },
];

describe("tui-state", () => {
  it("sorts visible rows by reclaimable size", () => {
    const state = createTuiState(rows);

    assert.deepEqual(visibleRows(state).map((row) => row.path), ["/d", "/a", "/c", "/b"]);
  });

  it("toggles only selectable rows", () => {
    let state = createTuiState(rows);

    state = handleTuiKey(state, { name: "space" });
    assert.deepEqual(selectedRows(state).map((row) => row.path), ["/d"]);

    state = handleTuiKey(state, { name: "down" });
    state = handleTuiKey(state, { name: "down" });
    state = handleTuiKey(state, { name: "space" });

    assert.deepEqual(selectedRows(state).map((row) => row.path), ["/d"]);
  });

  it("supports navigation keys with cursor clamping", () => {
    let state = createTuiState(rows);

    state = handleTuiKey(state, { name: "up" });
    assert.equal(state.cursor, 0);

    state = handleTuiKey(state, { name: "end" });
    assert.equal(state.cursor, 3);

    state = handleTuiKey(state, { name: "k" });
    assert.equal(state.cursor, 2);

    state = handleTuiKey(state, { name: "home" });
    assert.equal(state.cursor, 0);

    state = handleTuiKey(state, { name: "j" });
    assert.equal(state.cursor, 1);

    state = handleTuiKey(state, { name: "pagedown" });
    assert.equal(state.cursor, 3);

    state = handleTuiKey(state, { name: "u", ctrl: true });
    assert.equal(state.cursor, 0);
  });

  it("filters by tool, category, and path text", () => {
    const base = createTuiState(rows);

    assert.deepEqual(visibleRows({ ...base, filter: "claude" }).map((row) => row.path), ["/a", "/c"]);
    assert.deepEqual(visibleRows({ ...base, filter: "sessions" }).map((row) => row.path), ["/d"]);
    assert.deepEqual(visibleRows({ ...base, filter: "/b" }).map((row) => row.path), ["/b"]);
  });

  it("clamps cursor after filtering reduces visible rows", () => {
    const state = {
      ...createTuiState(rows),
      cursor: 3,
      filter: "sessions",
    };

    const next = handleTuiKey(state, { name: "down" });
    assert.equal(next.cursor, 0);
    assert.deepEqual(visibleRows(next).map((row) => row.path), ["/d"]);
  });

  it("sets intents for delete-selected, rescan, open-current, and quit", () => {
    assert.equal(handleTuiKey(createTuiState(rows), { name: "d" }).intent, "delete-selected");
    assert.equal(handleTuiKey(createTuiState(rows), { name: "delete" }).intent, "delete-selected");
    assert.equal(handleTuiKey(createTuiState(rows), { name: "r" }).intent, "rescan");
    assert.equal(handleTuiKey(createTuiState(rows), { name: "o" }).intent, "open-current");
    assert.equal(handleTuiKey(createTuiState(rows), { name: "q" }).intent, "quit");
    assert.equal(handleTuiKey(createTuiState(rows), { name: "escape" }).intent, "quit");
  });

  it("returns only selectable entries from selectedRows", () => {
    const state = {
      ...createTuiState(rows),
      selected: new Set(["/c", "/d"]),
    };

    assert.deepEqual(selectedRows(state).map((row) => row.path), ["/d"]);
  });
});
