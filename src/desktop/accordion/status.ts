// The words of the sections' status lines ("Name on", "Name off", "Name: value"),
// one place for every page.
type T = (k: string, o?: Record<string, unknown>) => string;
export const onOff = (t: T, name: string, on: boolean): string => t(on ? "desktop.accordion.on" : "desktop.accordion.off", { name });
export const named = (t: T, name: string, value: string | number): string => t("desktop.accordion.value", { name, value });
