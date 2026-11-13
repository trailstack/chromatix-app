# Gapless Playback

Chromatix supports true gapless playback — consecutive tracks play with **zero gap**, using sample-accurate transitions scheduled on the Web Audio clock. It is off by default and enabled under **Settings → Playback → Gapless Playback**.

## Table of contents<!-- omit in toc -->

- [1. What you get](#1-what-you-get)
- [2. How it works](#2-how-it-works)
  - [2.1. The engine](#21-the-engine)
  - [2.2. The queue mirror and the window](#22-the-queue-mirror-and-the-window)
  - [2.3. Seam advances](#23-seam-advances)
- [3. What is (and isn't) gapless](#3-what-is-and-isnt-gapless)
- [4. Trade-offs](#4-trade-offs)
- [5. Files involved](#5-files-involved)

## 1. What you get

With the setting enabled, any run of consecutive tracks that your browser can play directly (FLAC, MP3, AAC, OGG, WAV — i.e. anything that doesn't need server transcoding) plays back-to-back with no audible seam: live albums, DJ mixes, and classical works flow continuously. Shuffle and both repeat modes stay gapless, including repeat-one. Play/pause, seeking, the volume slider, the progress bar — everything keeps its place in the sample-accurate engine.

Tracks that need a server-side transcode (WMA, certain DSD wraps, etc.) are handed off to the regular player. The gap between the last gapless track and the transcoded one is normal, but once the transcoded track finishes the chain resumes gaplessly if the next track is directly playable.

## 2. How it works

### 2.1. The engine

Chromatix uses the [`gapless`](https://www.npmjs.com/package/gapless) npm package, a hybrid playback engine that combines an HTML5 streaming `<audio>` element with the Web Audio API:

- The streaming element opens the track immediately so playback starts without waiting.
- In the background the engine decodes the entire file into a `Float32Array` (a raw PCM buffer).
- Once decoding is complete the engine switches the AudioContext's output to the decoded buffer on a sample-accurate schedule.
- When the decoded buffer finishes, the engine seamlessly starts the next track's decoded buffer — no silence, no gap.

The engine is "hybrid" because it never plays exclusively through Web Audio (which would require loading the whole file first) and never plays exclusively through `<audio>` (which inserts a gap at track boundaries). It gets the best of both: instant start from streaming, gapless boundaries from Web Audio.

### 2.2. The queue mirror and the window

The Rematch store (`sessionModel.playingTrackList` + `playingTrackKeys`) is the single source of truth for the queue. The gapless module keeps a **queue mirror** — a lightweight array of track metadata and repeat flags that is rebuilt whenever the queue, shuffle order, or repeat mode changes.

From the mirror the engine builds a **sliding window** of upcoming tracks:

- It always includes the currently playing track.
- It looks ahead up to `WINDOW_AHEAD` (2) tracks.
- It stops the chain early if it hits a track that needs transcoding or the queue end.
- For repeat-one it repeats the current track in the window; for repeat-all it wraps to the queue start.

This window is small enough to keep memory usage low (only one extra decoded track is preloaded — `PRELOAD_NUM_TRACKS = 1` — which is ~21 MB per minute of 44.1 kHz stereo) but large enough for the engine to schedule the next boundary well before the current track ends.

### 2.3. Seam advances

When the engine crosses a track boundary on its own, it fires `onStartNewTrack` with the engine's internal track index. The gapless module maps that index back to the store's queue position and tells the store to advance — **without reloading the player**, because the next track is already playing.

After each seam the module re-syncs the queue mirror and extends (or trims) the engine's window to match the new position.

## 3. What is (and isn't) gapless

| Scenario | Gapless? |
|----------|----------|
| FLAC → FLAC (same browser-direct codec) | Yes |
| MP3 → AAC → OGG (all direct-playable) | Yes |
| FLAC → WMA (transcoded) → FLAC | No (gap at the transcode boundary only) |
| Shuffle (all direct) | Yes |
| Repeat-one | Yes (the same track restarts gaplessly) |
| Repeat-all wrap | Yes |
| Seek / scrub | No (seeking into a new position starts a fresh decode) |
| Pause → resume | No gap (the engine holds its position) |
| Volume change | No gap |
| iOS Safari | No — the engine disables itself on iOS (see §4) |

## 4. Trade-offs

- **Memory**: each preloaded track is decoded to raw PCM. At 44.1 kHz / 16-bit stereo that's ~312 KB per second, or ~21 MB per minute. With `PRELOAD_NUM_TRACKS = 1` the engine holds at most one extra decoded track in memory.
- **CPU**: decoding happens in the background via the Web Audio `AudioContext.decodeAudioData` API. On mid-range hardware decoding a 5-minute FLAC takes roughly 2–4 seconds and spikes the CPU for ~500 ms.
- **Platform**: the engine requires the Web Audio API and a platform where background audio is reliable. iOS Safari silences Web Audio through the hardware mute switch and suspends the `AudioContext` on screen lock, so the engine is disabled on iOS entirely. The setting shows a "not available" label on those devices.
- **Transcoded tracks**: a server-side transcode breaks the gapless chain because the transcoded stream is a fresh lossy session — there is no sample-accurate continuity to preserve. The normal player handles the transcoded track and the chain resumes gaplessly once a direct-playable track follows.

## 5. Files involved

| File | Role |
|------|------|
| `src/js/services/player.gapless.ts` | Gapless engine wrapper — queue mirror, window, seam advance, controls |
| `src/js/services/player.gapless.test.ts` | Unit tests for the gapless wrapper (mocks the `gapless` package) |
| `src/js/services/player.ts` | Player router — added `gapless` branch to all routing functions |
| `src/types/player.ts` | Extended type definitions: `GaplessInitParams`, `GaplessQueueEntry`, `GaplessQueueFlags`, extended `PlayerTrack` |
| `src/js/store/models.player.js` | Added gapless effects: `playerSyncGaplessQueue`, `playerSeamAdvance`, `playerGaplessError`, `playerGaplessToggle`; updated `playerRefresh`, `playerLoadTrackList`, `playerLoadIndex`, `updateNextTrack` |
| `src/js/store/models.player.gapless.test.ts` | Unit tests for the gapless store effects (mocks player/bridge boundaries) |
| `src/js/store/models.session.js` | Added `gaplessPlayback: false` to initial state |
| `src/js/components/SettingsPlayback/SettingsPlayback.jsx` | Replaced placeholder with real gapless toggle using `playerGaplessToggle` |
| `src/js/components/SettingsList/SettingsList.jsx` | Added `onChange` callback support for checkboxes |
| `package.json` | Added `gapless` dependency |
