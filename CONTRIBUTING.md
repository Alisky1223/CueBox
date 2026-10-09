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
2. Branch from `develop` with a name that starts with the issue number, e.g. `12-pgs-support`.
3. Keep commits small, with one-line messages.
4. Open a PR into `develop` whose description starts with `Closes #<issue>`.
5. Releases go from `develop` into `main` through a PR.

### Releasing

1. On a release branch, bump `version` in `package.json` and rename the CHANGELOG `[Unreleased]` section to `[x.y.z] - YYYY-MM-DD`.
2. Merge it into `develop`, then `develop` into `main`.
3. Tag the merge commit on `main` and push the tag:

   ```sh
   git switch main && git pull
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

The [Release workflow](.github/workflows/release.yml) checks that the tag matches `package.json`, runs the checks, builds, and publishes a GitHub Release. The release has `CueBox.html` attached and uses the CHANGELOG section as its notes. The same build is then deployed to [GitHub Pages](https://alisky1223.github.io/CueBox/) as the installable app.

### Protected branches

`main` and `develop` are protected, and nobody can push to them directly. Every change goes through a pull request that:

- has been approved by the code owner ([@Alisky1223](https://github.com/Alisky1223)),
- passes CI.

Force-pushes and deleting these branches are also blocked.

## Project layout

| Path                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `index.html`               | Page markup (Vite entry)                                |
| `src/main.js`              | App wiring: opening files, embedded subs, shortcuts     |
| `src/player/subtitles.js`  | Subtitle track state: selection, delay, cues            |
| `src/player/audio.js`      | Audio track switching: native API or synced sidecar     |
| `src/ui/`                  | Controls, menus, toasts, icons, formatting              |
| `src/mkv/ebml.js`          | Low-level EBML reading (vints, elements, blob reader)   |
| `src/mkv/scan.js`          | Matroska walker: tracks, then blocks of chosen tracks   |
| `src/mkv/extract.js`       | Matroska subtitle track and cue extraction (no DOM)     |
| `src/mkv/audio.js`         | Audio track listing and single-track remux (no DOM)     |
| `src/subtitles/parsers.js` | SRT/VTT/ASS parsing, text decoding, cue sanitising      |
| `public/`                  | PWA files copied as-is: manifest, service worker, icons |
| `tests/`                   | Vitest unit tests; `helpers/mkv.js` builds MKV fixtures |

## Adding tests

Parser and extractor code is DOM-free, so it can be tested directly in Node. For MKV cases, build a fixture in memory with `tests/helpers/mkv.js` rather than committing video files.
