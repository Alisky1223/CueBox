# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

CueBox: zero-install, fully offline browser video player. Vanilla JS (ES modules, no framework), built by Vite into a **single self-contained `dist/index.html`** (`vite-plugin-singlefile`) that must run from `file://`. Also deployed as a PWA to GitHub Pages.

## Commands

Package manager is **pnpm** (pinned via Corepack, `packageManager` in package.json). Node >= 20.

```sh
pnpm install
pnpm dev                          # http://localhost:5173
pnpm test                         # vitest run (tests/**/*.test.js)
pnpm vitest run tests/parsers.test.js     # single file
pnpm vitest run -t "name of test"         # single test by name
pnpm lint                         # eslint
pnpm format:check                 # prettier (pnpm format to fix)
pnpm build                        # dist/index.html
```

CI (`.github/workflows/ci.yml`) runs lint, format:check, test, build — run all four before a PR.

## Architecture

- `src/main.js` wires everything: file open (picker, drag-drop, PWA `launchQueue`), codec detection, kicking off MKV subtitle/audio scans, keyboard shortcuts. Opening a new video aborts the previous scan via an `AbortController` and resets `SubtitleManager`/`AudioTracks`; async work checks it's still current before touching state.
- **`src/mkv/` and `src/subtitles/` are DOM-free** (pure parsing on `Blob`/`Uint8Array`) so they're testable in Node. Keep DOM out of them.
  - `ebml.js`: vint/element primitives, chunked blob `Reader`, plus EBML writers (used for remuxing).
  - `scan.js`: streaming Matroska walker; parses Tracks, then emits blocks only for requested tracks (callbacks `onTracks`/`onBlock`/`onProgress`, `signal`).
  - `extract.js`: subtitle tracks → cues, streamed to the UI as found. `audio.js`: lists audio tracks and remuxes a single track into a standalone MKV blob.
- `src/player/subtitles.js` `SubtitleManager`: subtitles are native `TextTrack`s (`video.addTextTrack` + `VTTCue`), active one set to `showing`, browser renders them. Text tracks can't be removed, so `reset()` disables old ones. Delay rewrites cue times from stored `origStart`/`origEnd`.
- `src/player/audio.js` `AudioTracks`: uses native `video.audioTracks` when available (Safari); otherwise extracts the chosen track from the MKV and plays it in a hidden "sidecar" `<audio>` kept in sync with the video (drift nudging/jumping), silencing the video's own sound through Web Audio so volume/mute stay user-controlled.
- `src/player/video-codec.js`: detects HEVC files and whether the browser can decode them (Chrome shows black video instead of erroring).
- `src/ui/`: controls, menus, toasts, icons; `storage.js` wraps localStorage for persisted prefs.
- `src/party/` Watch together: `link.js` pairs two browsers via PeerJS (public cloud broker, ids `cuebox-<code>`, WebRTC data channel, JSON messages); `sync.js` `SyncSession` is DOM-free (media adapter + `send`), host is leader and sends heartbeats, either side sends play/pause/seek/rate, echo of applied remote state suppressed. `voice.js` `VoiceChat`: PeerJS media call, started lazily by whoever first turns on the mic (host's call wins a tie); outgoing track is a Web Audio destination, silent until the mic is on and the gate (`voice-gate.js`, DOM-free: threshold + hold, or push to talk) opens, so no renegotiation; partner's level drives ducking via `controls.setDuck`. UI in `src/ui/party-menu.js`, `party-chat.js`, `party-voice.js`.
- `public/`: PWA files copied as-is (`manifest.webmanifest`, `sw.js` cache-first with background refresh, icons). SW only registers in prod over https/localhost.

## Tests

Vitest in Node. For MKV cases build fixtures in memory with `tests/helpers/mkv.js` — don't commit video files.

## Workflow

- Branch from `develop`, name starts with issue number (e.g. `12-pgs-support`); PR into `develop`, description starts with `Closes #N`. `main` only accepts PRs from `develop` (enforced by CI `main-source` job). Both branches are protected.
- Add user-facing changes under `## [Unreleased]` in `CHANGELOG.md`.
- Release: bump `package.json` version + rename CHANGELOG section to `[x.y.z] - YYYY-MM-DD`, merge to `develop` → `main`, tag `vX.Y.Z`. `release.yml` verifies tag == package version, publishes `CueBox.html` with the CHANGELOG section as notes, deploys Pages.
- Root `index.html` is the Vite entry and doesn't work opened directly; use `pnpm dev` or the build.
