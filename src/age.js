const UNIT_MS = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDurationMs(input) {
  const match = /^(\d+)([mhd])$/.exec(input);
  if (!match) {
    throw new Error(`Invalid duration: ${input}`);
  }

  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid duration: ${input}`);
  }

  return value * UNIT_MS[match[2]];
}

export function isOlderThan(mtimeMs, nowMs, olderThanMs) {
  return nowMs - mtimeMs >= olderThanMs;
}
