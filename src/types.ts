export type ToolName = "claude" | "pi" | "omp" | "temp";
export type EntryType = "file" | "directory";
export type Action = "keep" | "trash" | "delete" | "delegate";

export interface CleanerOptions {
  homeDir: string;
  tempDir: string;
  nowMs: number;
  olderThanMs: number;
  includeCache: boolean;
  apply: boolean;
  permanent: boolean;
  tools: Set<ToolName>;
}

export interface ManifestEntry {
  tool: ToolName;
  category: string;
  path: string;
  type: EntryType;
  sizeBytes: number;
  modifiedMs: number;
  action: Action;
  reason: string;
  protected: boolean;
}

export interface ScanResult {
  entries: ManifestEntry[];
  errors: string[];
}
