// How each language names the connected board inside its strings: the
// {{device…}} variables every locale string can use (filled in for every t()
// call, see hardwareName.ts). [named, generic]: `named` when the board's name
// is known ("Pico 2 W", from the firmware or the last board that connected),
// `generic` when it isn't (always "your board", one wording per language).
//
// A language with articles or cases gets one variable per grammatical spot its
// strings need ("auf {{device_dat}}" → "auf dem Pico 2 W" / "auf deinem
// Board"). Sentence-initial use: {{device, capitalize}}. deviceName is the bare
// name for headings and labels ("Pico 2 W" / "Your board").

export type DeviceForms = Record<string, readonly [named: string, generic: string]>;

export const DEVICE_FORMS: Record<string, DeviceForms> = {
  en: {
    deviceName: ["{{name}}", "Your board"],
    device: ["the {{name}}", "your board"],
  },
  de: {
    deviceName: ["{{name}}", "Dein Board"],
    device: ["der {{name}}", "dein Board"], // Nominativ
    device_akk: ["den {{name}}", "dein Board"],
    device_dat: ["dem {{name}}", "deinem Board"],
    device_gen: ["des {{name}}", "deines Boards"],
    device_vom: ["vom {{name}}", "von deinem Board"],
    device_im: ["im {{name}}", "in deinem Board"],
  },
  fr: {
    deviceName: ["{{name}}", "Ta carte"],
    device: ["le {{name}}", "ta carte"],
    device_de: ["du {{name}}", "de ta carte"],
    device_a: ["au {{name}}", "à ta carte"],
  },
  es: {
    deviceName: ["{{name}}", "Tu placa"],
    device: ["el {{name}}", "tu placa"],
    device_de: ["del {{name}}", "de tu placa"],
    device_a: ["al {{name}}", "a tu placa"],
  },
  pt: {
    deviceName: ["{{name}}", "Sua placa"],
    device: ["o {{name}}", "sua placa"],
    device_de: ["do {{name}}", "da sua placa"],
    device_em: ["no {{name}}", "na sua placa"],
    device_a: ["ao {{name}}", "à sua placa"],
    device_por: ["pelo {{name}}", "pela sua placa"],
  },
  ja: {
    deviceName: ["{{name}}", "お使いのボード"],
    device: ["{{name}}", "お使いのボード"],
  },
  zh: {
    deviceName: ["{{name}}", "你的开发板"],
    device: ["{{name}}", "你的开发板"],
  },
};

/** The {{device…}} values for `lng` (a bare code, falls back to English). */
export function deviceVariables(lng: string | undefined, name: string | null): Record<string, string> {
  const forms = DEVICE_FORMS[(lng ?? "en").split("-")[0]] ?? DEVICE_FORMS.en;
  const out: Record<string, string> = {};
  for (const [key, [named, generic]] of Object.entries(forms)) out[key] = name ? named.replace("{{name}}", name) : generic;
  return out;
}

export const capitalize = (value: string): string => value.charAt(0).toLocaleUpperCase() + value.slice(1);
