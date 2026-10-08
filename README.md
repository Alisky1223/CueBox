# CueBox

[![CI](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Drop a file, get your subtitles.** A zero-install offline video player that finds the soft subs inside your MKV files and shows them right away.

<!-- TODO: add screenshot at docs/screenshot.png -->

## Features

- **Open any local video.** Use the file picker or drag and drop the file onto the page.
- **Embedded subtitles turn on automatically.** Text subtitle tracks (SRT/ASS/SSA/WebVTT) inside MKV/WebM files are read in the browser and shown at once, with no ffmpeg needed.
- **Add your own subtitles.** Load `.srt`, `.vtt`, `.ass` or `.ssa` files. Persian/Arabic files saved in Windows-1256 instead of UTF-8 also work.
- **Switch or turn off subtitles.** Pick any track from the subtitle menu, or choose **Off**. You can also change the subtitle size and background, and shift timing when subtitles are out of sync.
- **A polished player.** It has a dark cinematic theme, a seek bar that previews the time, speed control, picture-in-picture and fullscreen. Controls hide on their own while the video plays.
- **100% offline.** Nothing is uploaded and there's nothing to install. The build is a single HTML file.

## Usage

Download `index.html` from the latest [CI run](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml) (artifact **cuebox**), or build it yourself (see below). Then open it in Chrome or Edge. Double-clicking it works, with no server needed.

> The `index.html` in the repo root is the development source and won't run when opened directly. Use `dist/index.html` or `pnpm dev` instead.

### Keyboard shortcuts

| Key           | Action                  |
| ------------- | ----------------------- |
| `Space` / `K` | Play / pause            |
| `←` / `→`     | Seek 5s                 |
| `J` / `L`     | Seek 10s                |
| `↑` / `↓`     | Volume                  |
| `M`           | Mute                    |
| `F`           | Fullscreen              |
| `C`           | Cycle subtitle tracks   |
| `G` / `H`     | Subtitle delay −/+ 0.1s |
| `O`           | Open video              |

## Development

You need Node 20 or newer, with Corepack enabled (`corepack enable`).

```sh
pnpm install
pnpm dev      # dev server at http://localhost:5173
pnpm test     # unit tests
pnpm build    # outputs dist/index.html (single self-contained file)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and project layout.

## Limitations

- Image-based subtitles (PGS, VobSub) aren't supported.
- Subtitles embedded in MP4 files aren't extracted. Load them with **Add subtitle** instead.
- Whether a video plays depends on your browser's codecs. HEVC/x265, for example, needs hardware decoding support.

## License

[MIT](LICENSE)

## Original Contributors

- Alireza Asadi
- (My Love) Sahar Jahaniyan
