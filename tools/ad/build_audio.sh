#!/usr/bin/env bash
# The ad's one audio track, shared by every language's cut: the narrator's
# "There you are." in all 7 languages, back to back, over the music, which
# builds steadily from silence to full over the first 12 s (on its own
# curve, not ducked by the voice) and ends exactly at 30 s. Also writes the
# opener's timing (segments.json) so the tagline follows the language she's
# speaking.
#   tools/ad/build_audio.sh music.wav out-dir     (music from master_music.sh)
set -euo pipefail
music="$1"; out="$2"
V="$(cd "$(dirname "$0")/../.." && pwd)/assets-src/voice"
LANGS=(en de fr es pt-BR zh-CN ja)
GAP=0.12
ins=(); f=""; cat=""; segs="["; t=0
for i in "${!LANGS[@]}"; do
  l=${LANGS[$i]}
  ins+=(-i "$V/$l/app_controller.mp3")
  f+="[$i:a]aresample=48000,apad=pad_dur=$GAP[v$i];"; cat+="[v$i]"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$V/$l/app_controller.mp3")
  segs+="{\"lang\":\"$l\",\"start\":$t,\"end\":$(python3 -c "print(round($t+$d,3))")},"
  t=$(python3 -c "print(round($t+$d+$GAP,3))")
done
echo "${segs%,}]" > "$out/segments.json"
ffmpeg -loglevel error -y "${ins[@]}" -filter_complex "${f}${cat}concat=n=${#LANGS[@]}:v=0:a=1,loudnorm=I=-16:TP=-2,aresample=48000[vo]" -map "[vo]" "$out/voices.wav"
ffmpeg -loglevel error -y -i "$music" -i "$out/voices.wav" -filter_complex \
  "[0:a]volume='if(lt(t,12),pow(10,(-30+30*t/12)/20),1)':eval=frame[m];[m][1:a]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[a]" \
  -map "[a]" -c:a pcm_s16le "$out/ad-audio.wav"
echo "$out/ad-audio.wav (opener ${t}s)"
