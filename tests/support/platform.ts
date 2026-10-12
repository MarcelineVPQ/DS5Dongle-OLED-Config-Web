// For tests built on Linux launcher folders: run them as Linux on any test
// machine (the Games code takes its Windows paths on Windows, so on the
// release CI's Windows job these would test the wrong code).
import { afterAll, beforeAll } from "vitest";

export function asLinux(): void {
  let real: NodeJS.Platform;
  beforeAll(() => {
    real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  });
  afterAll(() => Object.defineProperty(process, "platform", { value: real, configurable: true }));
}
