// The readable text of anything thrown (an Error's message, else the value
// itself), for showing in the UI and logs. Shared by the app and main process.
export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// An error the user needn't see, logged with the one-line reason why, never
// dropped (CLAUDE.md "Error pass"): `promise.catch(logged("why"))`, or
// `logged("why")(cause)` in a catch block. tools/list_errors.mjs reads the
// reason as the row's LOGGED-OK verdict.
export function logged(why: string): (cause: unknown) => void {
  return (cause) => console.warn(`${why}:`, errorText(cause));
}
