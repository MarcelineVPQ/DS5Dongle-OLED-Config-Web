// Windows: the running programs, read in this process from one Toolhelp
// snapshot (kernel32, called through koffi). About 1 ms a pass; spawning
// tasklist every 3 s cost ~6.7 % of a 2-vCPU PC in the tray (the app's main
// process ~3.9 %, tasklist itself ~2.7 %; Win11 VM, 2026-10-14). tasklist stays
// as the fallback when the native call can't be loaded.
import type { ProcView } from "./running";

// PROCESSENTRY32W's fields (tlhelp32.h); koffi lays it out like the C compiler
// (568 bytes on 64-bit Windows).
const ENTRY_FIELDS = {
  dwSize: "uint32_t",
  cntUsage: "uint32_t",
  th32ProcessID: "uint32_t",
  th32DefaultHeapID: "uintptr_t",
  th32ModuleID: "uint32_t",
  cntThreads: "uint32_t",
  th32ParentProcessID: "uint32_t",
  pcPriClassBase: "int32_t",
  dwFlags: "uint32_t",
} as const;
const TH32CS_SNAPPROCESS = 0x2;
const INVALID_HANDLE_VALUE = 0xffffffffffffffffn;

interface Entry {
  dwSize: number;
  th32ProcessID?: number;
  szExeFile?: string;
}

// Loads kernel32's snapshot functions and returns a reader. Throws where koffi
// or its native part isn't available (the caller falls back to tasklist).
export async function loadToolhelp(): Promise<() => ProcView[]> {
  const koffi = (await import("koffi")).default;
  // lifetime: NOT-WORTH — kernel32 is loaded in every Windows process; one handle per app, lives until quit
  const kernel32 = koffi.load("kernel32.dll");
  const entryType = koffi.struct("DS5_PROCESSENTRY32W", { ...ENTRY_FIELDS, szExeFile: koffi.array("char16_t", 260, "String") });
  const size = koffi.sizeof(entryType);
  const createSnapshot = kernel32.func("__stdcall", "CreateToolhelp32Snapshot", "void *", ["uint32_t", "uint32_t"]);
  const first = kernel32.func("__stdcall", "Process32FirstW", "bool", ["void *", koffi.inout(koffi.pointer(entryType))]);
  const next = kernel32.func("__stdcall", "Process32NextW", "bool", ["void *", koffi.inout(koffi.pointer(entryType))]);
  const closeHandle = kernel32.func("__stdcall", "CloseHandle", "bool", ["void *"]);
  return () => {
    // lifetime: OK — closed in the finally below, every pass
    const snapshot: unknown = createSnapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == null || koffi.address(snapshot) === INVALID_HANDLE_VALUE) throw new Error("CreateToolhelp32Snapshot failed");
    const out: ProcView[] = [];
    try {
      const entry: Entry = { dwSize: size };
      // loop: HOT-PATH-OK — one entry per running program (~150), every 3 s; no I/O, a few µs each
      for (let ok = first(snapshot, entry) as boolean; ok; ok = next(snapshot, entry) as boolean) {
        if (entry.szExeFile) out.push({ pid: entry.th32ProcessID ?? 0, comm: entry.szExeFile, args: [], cwd: null, env: {} });
        entry.dwSize = size;
      }
    } finally {
      closeHandle(snapshot);
    }
    return out;
  };
}

// The Windows reader: the native snapshot once it has loaded, else (or after
// it fails) `fallback` (tasklist). `load` is for the tests.
export function windowsProcReader(fallback: () => Promise<ProcView[]>, load: () => Promise<() => ProcView[]> = loadToolhelp): () => Promise<ProcView[]> {
  // cache: OK — key=none (the loaded native reader, or null once it failed); invalidated=never, a failed load stays on tasklist for this run; bound=1 entry
  let native: Promise<(() => ProcView[]) | null> | null = null;
  return async () => {
    // error: LOGGED-OK — no native reader on this PC: the running-game check keeps working through tasklist (only costs more CPU)
    native ??= load().catch((cause: unknown) => {
      console.warn("running programs: native snapshot unavailable, using tasklist:", cause);
      return null;
    });
    const read = await native;
    if (read) {
      try {
        return read();
      } catch (cause) {
        // error: LOGGED-OK — this pass reads through tasklist; the next pass tries the snapshot again
        console.warn("running programs: snapshot failed, using tasklist for this pass:", cause);
      }
    }
    return fallback();
  };
}
