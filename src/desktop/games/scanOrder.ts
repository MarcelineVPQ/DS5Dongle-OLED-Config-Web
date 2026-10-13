// The Games page asks for scans from several places (Home, a game page's
// Apply, Undo). Two helpers keep what it shows equal to the launchers' files.

// Only the newest of overlapping requests counts: an earlier, slower scan
// that resolves later never replaces a newer report.
export function latestOnly(): <T>(request: Promise<T>) => Promise<{ value: T; current: boolean }> {
  let seq = 0;
  return (request) => {
    const mine = ++seq;
    return request.then((value) => ({ value, current: mine === seq }));
  };
}

// Run a change, then rescan whatever happened (also when it failed or threw
// after writing), so the page never shows the settings from before it.
export async function thenRescan<T>(change: () => Promise<T>, rescan: () => unknown): Promise<T> {
  try {
    return await change();
  } finally {
    await rescan();
  }
}
