#!/usr/bin/env python3
"""Master the narrator's lines for the DualSense's small mono speaker (every
line plays there only). Two passes, so all clips land at the same loudness:

 1. shape: cut below 280 Hz (the speaker can't reproduce it; it only muddies),
    lift speech presence around 2.8 kHz, compress hard;
 2. measure the shaped clip's integrated loudness (EBU R128), apply the gain
    that brings it to TARGET_LUFS (the level approved by ear on the
    controller, 2026-10-10), then a 4x-oversampled limiter keeps true peaks
    at or below -1 dBTP.

Output: assets-src/voice/<lang>-speaker/<key>.wav, 48 kHz mono 16-bit (the
firmware's audio format).

  python3 tools/master_voice.py [lang ...]     (default: all languages)
"""
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE = ROOT / "assets-src/voice"
TARGET_LUFS = -14.0
LIMIT_DBTP = -1.0
SHAPE = "highpass=f=280:poles=2,equalizer=f=2800:t=o:w=1.4:g=6,acompressor=threshold=-28dB:ratio=6:attack=3:release=60:makeup=8"


def loudness(path: Path) -> float:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    return float(re.findall(r"I:\s+(-?[\d.]+) LUFS", out)[-1])


def master(src: Path, out: Path) -> None:
    shaped = out.with_suffix(".shaped.wav")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(src), "-af", SHAPE, "-ar", "48000", "-ac", "1", "-c:a", "pcm_f32le", str(shaped)], check=True)
    gain = TARGET_LUFS - loudness(shaped)
    limit = 10 ** (LIMIT_DBTP / 20)
    chain = f"volume={gain:.2f}dB,aresample=192000,alimiter=limit={limit:.4f}:attack=1:release=50:level=disabled,aresample=48000"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(shaped), "-af", chain, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", str(out)], check=True)
    shaped.unlink()


def main() -> None:
    langs = sys.argv[1:] or json.load(open(VOICE / "lines.json"))["languages"]
    for lang in langs:
        out_dir = VOICE / f"{lang}-speaker"
        out_dir.mkdir(exist_ok=True)
        for src in sorted((VOICE / lang).glob("*.mp3")):
            master(src, out_dir / f"{src.stem}.wav")
        print(f"{lang}: mastered {len(list((VOICE / lang).glob('*.mp3')))} lines")


if __name__ == "__main__":
    main()
