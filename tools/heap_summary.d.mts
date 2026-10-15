export interface HeapSummary {
  totalMb: number;
  nodes: number;
  detached: number;
  byName: Record<string, { count: number; size: number }>;
}
export function summarizeSnapshotData(snap: unknown, top?: number): HeapSummary;
export function summarizeHeapSnapshot(file: string, top?: number): HeapSummary;
export function diffSummaries(a: HeapSummary, b: HeapSummary, top?: number): Array<{ key: string; count: number; size: number }>;
