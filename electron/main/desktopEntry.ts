// One argument of a desktop entry's Exec= key, per the Desktop Entry spec:
// quoted, with " ` $ \ escaped inside the quotes, then the string-value
// escaping of the file itself (\ doubled) and % doubled (field codes).
export function execArg(arg: string): string {
  const quoted = `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}
