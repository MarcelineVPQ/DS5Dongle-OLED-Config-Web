#!/usr/bin/env python3
"""Encode the narrator's app lines (app_*, tour_*) from the speaker masters
into small Ogg Opus files bundled with the app: src/assets/voice/<lang>/,
plus captions.json (the words of every line in every language).
The controller's own lines (fw_*) go into the firmware instead.

  python3 tools/master_voice.py && python3 tools/build_voice_assets.py
"""
import json, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE = ROOT / "assets-src/voice"
OUT = ROOT / "src/assets/voice"


def main() -> None:
    spec = json.load(open(VOICE / "lines.json"))
    keys = [l["key"] for l in spec["lines"] if not l["key"].startswith("fw_")]
    total = 0
    for lang in spec["languages"]:
        (OUT / lang).mkdir(parents=True, exist_ok=True)
        for key in keys:
            src = VOICE / f"{lang}-speaker" / f"{key}.wav"
            dst = OUT / lang / f"{key}.ogg"
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-c:a", "libopus", "-b:a", "40k", "-vbr", "on", "-application", "voip", "-ar", "48000", "-ac", "1", str(dst)], check=True)
            total += dst.stat().st_size
    # The words, for captions (shown while she speaks).
    captions = {l["key"]: {lang: (l["text"] if lang == "en" else l[f"text_{lang}"]) for lang in spec["languages"]} for l in spec["lines"] if l["key"] in keys}
    (OUT / "captions.json").write_text(json.dumps(captions, ensure_ascii=False, indent=1) + "\n")
    print(f"{len(keys)} lines x {len(spec['languages'])} languages, {total // 1024} KB (+ captions.json)")


if __name__ == "__main__":
    main()
