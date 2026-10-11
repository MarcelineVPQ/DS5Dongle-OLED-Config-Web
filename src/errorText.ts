// The readable text of anything thrown (an Error's message, else the value
// itself), for showing in the UI and logs. Shared by the app and main process.
export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
