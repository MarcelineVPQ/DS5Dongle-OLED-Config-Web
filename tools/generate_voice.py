#!/usr/bin/env python3
"""Generate the narrator's voice lines (assets-src/voice/lines.json) with
ElevenLabs. The API key is read from ~/.claude.json (the ElevenLabs MCP
entry) or ELEVENLABS_API_KEY and never printed.

  python3 tools/generate_voice.py [--lang en] [--only key1,key2] [--force]
"""
import argparse, json, os, re, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINES = ROOT / "assets-src/voice/lines.json"


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key.startswith("sk_"):
        try:
            key = json.load(open(Path.home() / ".claude.json"))["mcpServers"]["elevenlabs"]["env"]["ELEVENLABS_API_KEY"]
        except (OSError, KeyError, ValueError):
            key = ""
    if not key.startswith("sk_"):
        sys.exit("No ElevenLabs API key (sk_...) found.")
    return key


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="en")
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    spec = json.load(open(LINES))
    voice = spec["voice"]
    out_dir = ROOT / "assets-src/voice" / args.lang
    out_dir.mkdir(parents=True, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    key = api_key()
    for line in spec["lines"]:
        if only and line["key"] not in only:
            continue
        out = out_dir / f"{line['key']}.mp3"
        if out.exists() and not args.force:
            print(f"skip {out.name} (exists)")
            continue
        text = line["tagged"] if args.lang == "en" else line[f"tagged_{args.lang}"]
        model = voice.get("models", {}).get(args.lang, voice["model"])
        if model != "eleven_v3":  # only v3 understands [tags]; others would read them out
            text = re.sub(r"\[[^\]]*\]\s*", "", text)
        body = json.dumps({
            "text": text,
            "model_id": model,
            "language_code": {"pt-BR": "pt", "zh-CN": "zh"}.get(args.lang, args.lang),
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.0, "use_speaker_boost": True, "speed": line.get("speed", 1.0)},
        }).encode()
        req = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice.get('voices', {}).get(args.lang, voice)['id']}?output_format={voice['format']}",
            data=body,
            headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
        )
        try:
            audio = urllib.request.urlopen(req, timeout=120).read()
        except urllib.error.HTTPError as e:
            sys.exit(f"{line['key']}: HTTP {e.code} {e.read()[:300]!r}")
        out.write_bytes(audio)
        print(f"wrote {out.relative_to(ROOT)} ({len(audio) // 1024} KB)")


if __name__ == "__main__":
    main()
