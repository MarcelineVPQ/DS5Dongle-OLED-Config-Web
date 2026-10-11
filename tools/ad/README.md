# The 30-second app ad

Rendered from the real app, frame by frame:
- the camera zooms out from the live controller;
- the controller blends through the 13 colorways;
- the app's interface cycles through its 7 languages;
- white text with a black outline: a tagline, six features and an end card.

Everything is on one shared audio track:
- the narrator says "There you are." in all 7 languages, and the on-screen tagline follows the language she's speaking;
- under her, the synthwave music builds steadily from silence over the first 12 s and ends at 30 s.

The text lives in the app's locale files (`ad` section), so every language has it.

```bash
# 1. Music (generated with ElevenLabs' music model), mastered once:
tools/ad/master_music.sh music.mp3 out/music-master.wav
# 2. The shared audio track + the opener's timing (segments.json):
tools/ad/build_audio.sh out/music-master.wav out
# 3. The app, with a dongle and a controller connected:
./node_modules/.bin/electron . --no-sandbox --remote-debugging-port=9333
# 4. One cut per language, about 2 minutes each:
node tools/ad/render_ad.mjs --lang de --music out/ad-audio.wav --segments out/segments.json --out out/ad-de.mp4
```

While it renders, the app window resizes and reloads. Cover it rather than minimizing it (a minimized window may stop painting), and keep the controller awake: if it disconnects, the renderer stops and says when.

The v0.8.0 renders and their audio sources are kept outside the repo (about 130 MB), in `~/Videos/DS5Dongle-ad-v0.8.0/` on the developer's PC.
