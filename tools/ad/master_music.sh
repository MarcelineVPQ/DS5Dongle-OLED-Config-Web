#!/usr/bin/env bash
# Master the ad's music once: measured gain to -14 LUFS, a limiter for
# peaks, a 1.4 s fade-out ending at 30 s, 48 kHz WAV for the muxer.
#   tools/ad/master_music.sh track.mp3 music.wav
set -euo pipefail
in="$1"; out="$2"
I=$(ffmpeg -hide_banner -i "$in" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *-\?[0-9.]*" | grep -o "\-\?[0-9.]*" | tail -1)
G=$(python3 -c "print(round(-14 - ($I), 2))")
ffmpeg -loglevel error -y -i "$in" -af "volume=${G}dB,alimiter=limit=0.84:level=false,afade=t=out:st=28.6:d=1.4,aresample=48000" -c:a pcm_s16le "$out"
echo "$out: ${I} LUFS -> -14 (gain ${G} dB)"
