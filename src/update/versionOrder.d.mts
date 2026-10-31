// Types for versionOrder.mjs (the one version ordering, shared with the Node tools).
export function parseVersion(raw: string | null | undefined): [number, number, number] | null;
export function devNumber(raw: string | null | undefined): number | null;
export function versionKey(raw: string | null | undefined): [number, number, number, number] | null;
export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null;
