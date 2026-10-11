// Liquid glass + specular rim on one element; returns its callback ref.
import { useCallback, useState } from "react";
import type { GlassOptions } from "./liquidGlass";
import { useLiquidGlass } from "./useLiquidGlass";
import { useSpecular } from "./useSpecular";

export function useGlass(on: boolean, clear: Partial<GlassOptions>, regular?: Partial<GlassOptions>): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const glassRef = useLiquidGlass(on, clear, regular);
  useSpecular(el, on);
  return useCallback(
    (node: HTMLElement | null) => {
      setEl(node);
      glassRef(node);
    },
    [glassRef],
  );
}
