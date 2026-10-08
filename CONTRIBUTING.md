# Contributing to CueBox

Thanks for helping out!

## Setup

You need Node 20 or newer, with [Corepack](https://nodejs.org/api/corepack.html) enabled (`corepack enable`). Corepack provides the pinned pnpm version.

```sh
pnpm install
pnpm dev        # dev server with hot reload
```

## Before opening a PR

```sh
pnpm lint
pnpm format:check   # or `pnpm format` to fix
pnpm test
pnpm build
```

CI runs the same checks on every pull request.

## Workflow

1. Open an issue, or pick an existing one.
2. Branch from `main` with a name that starts with the issue number, e.g. `12-pgs-support`.
3. Keep commits small, with one-line messages.
4. Open a PR whose description starts with `Closes #<issue>`.

## Project layout

| Path                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `index.html`               | Page markup (Vite entry)                                |
| `src/main.js`              | UI: file picking, tracks, subtitle selection            |
| `src/mkv/ebml.js`          | Low-level EBML reading (vints, elements, blob reader)   |
| `src/mkv/extract.js`       | Matroska subtitle track and cue extraction (no DOM)     |
| `src/subtitles/parsers.js` | SRT/VTT/ASS parsing, text decoding, cue sanitising      |
| `tests/`                   | Vitest unit tests; `helpers/mkv.js` builds MKV fixtures |

## Adding tests

Parser and extractor code is DOM-free, so it can be tested directly in Node. For MKV cases, build a fixture in memory with `tests/helpers/mkv.js` rather than committing video files.
