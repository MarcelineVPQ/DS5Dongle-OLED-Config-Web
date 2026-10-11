#!/usr/bin/env python3
"""Quality check for the narrator's lines (run after generating or
re-rolling; needs ffmpeg, and the ElevenLabs key for transcripts):

  - speaker masters: loudness within 1 LU of the approved -14 LUFS, true peak
    at or below -0.5 dBTP, no long silence at either end;
  - transcripts: each raw take is transcribed (ElevenLabs Scribe) and must
    match its script (similarity >= 0.85, punctuation and case ignored).
    Spoken-language detection is reported but not failed on: it's unreliable
    on clips this short.

  python3 tools/check_voice.py [--no-stt] [lang ...]
Writes assets-src/voice/check-report.json; exits 1 if anything fails.
"""
import difflib, json, os, re, subprocess, sys, unicodedata, urllib.request, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICE = ROOT / "assets-src/voice"
TARGET, TOL, MAX_TP, MAX_SILENCE = -14.0, 1.0, -0.5, 0.35


def levels(path: Path) -> dict:
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true,silencedetect=n=-45dB:d=0.2", "-f", "null", "-"], capture_output=True, text=True).stderr
    dur = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).decode())
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", err)]
    lead = ends[0] if starts and starts[0] <= 0.01 and ends else 0.0
    tail = dur - starts[-1] if starts and (len(starts) > len(ends)) else 0.0
    return {"lufs": float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1]), "tp": float(re.findall(r"Peak:\s+(-?[\d.]+) dBFS", err)[-1]), "lead": round(lead, 2), "tail": round(tail, 2), "dur": round(dur, 2)}


def api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not key.startswith("sk_"):
        key = json.load(open(Path.home() / ".claude.json"))["mcpServers"]["elevenlabs"]["env"]["ELEVENLABS_API_KEY"]
    return key


def transcribe(key: str, path: Path) -> tuple[str, str]:
    b = uuid.uuid4().hex
    body = (f'--{b}\r\nContent-Disposition: form-data; name="model_id"\r\n\r\nscribe_v1\r\n--{b}\r\nContent-Disposition: form-data; name="file"; filename="a.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n').encode() + path.read_bytes() + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request("https://api.elevenlabs.io/v1/speech-to-text", data=body, headers={"xi-api-key": key, "Content-Type": f"multipart/form-data; boundary={b}"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    return r.get("text", ""), r.get("language_code", "")


def norm(s: str) -> str:
    # Case, punctuation and width ignored; katakana folded to hiragana (the
    # same sounds: Scribe may write ばっちり as バッチリ).
    s = unicodedata.normalize("NFKC", s.lower())
    s = "".join(chr(ord(c) - 0x60) if "\u30a1" <= c <= "\u30f6" else c for c in s)
    return "".join(c for c in s if c.isalnum())


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    stt = "--no-stt" not in sys.argv
    spec = json.load(open(VOICE / "lines.json"))
    langs = args or spec["languages"]
    key = api_key() if stt else ""
    jobs = [(lang, line) for lang in langs for line in spec["lines"]]

    def check(job):
        lang, line = job
        text = line["text"] if lang == "en" else line[f"text_{lang}"]
        res = {"lang": lang, "key": line["key"], "text": text, **levels(VOICE / f"{lang}-speaker" / f"{line['key']}.wav"), "problems": []}
        if abs(res["lufs"] - TARGET) > TOL: res["problems"].append(f"loudness {res['lufs']} LUFS")
        if res["tp"] > MAX_TP: res["problems"].append(f"true peak {res['tp']} dBTP")
        if res["lead"] > MAX_SILENCE or res["tail"] > MAX_SILENCE: res["problems"].append(f"silence lead {res['lead']}s / tail {res['tail']}s")
        if stt:
            heard, detected = transcribe(key, VOICE / lang / f"{line['key']}.mp3")
            res.update(heard=heard, detected=detected, match=round(difflib.SequenceMatcher(None, norm(heard), norm(text)).ratio(), 2))
            # A take approved by ear on the controller can have a transcript
            # Scribe keeps misreading (e.g. Portuguese "Slot um" heard as English).
            if res["match"] < 0.85 and lang not in line.get("approvedByEar", []):
                res["problems"].append(f"transcript {res['match']}: heard {heard!r}")
        return res

    with ThreadPoolExecutor(6) as ex:
        results = list(ex.map(check, jobs))
    (VOICE / "check-report.json").write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n")
    bad = [r for r in results if r["problems"]]
    for lang in langs:
        rs = [r for r in results if r["lang"] == lang]
        print(f"{lang:6} {len(rs) - sum(1 for r in rs if r['problems'])}/{len(rs)} ok")
    for r in bad:
        print(f"  {r['lang']} {r['key']}: {'; '.join(r['problems'])}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
