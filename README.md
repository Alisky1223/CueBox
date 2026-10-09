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
- **Switch audio tracks.** Videos with several audio tracks (for example, multiple dubs) get an audio menu. In MKV/WebM files, CueBox reads the chosen track itself, so this works in Chrome and Edge without any flags.
- **A polished player.** It has a dark cinematic theme, a seek bar that previews the time, speed control, picture-in-picture and fullscreen. Controls hide on their own while the video plays.
- **100% offline.** Nothing is uploaded and there's nothing to install. The build is a single HTML file.

## Usage

### Install as an app (recommended)

Open [alisky1223.github.io/CueBox](https://alisky1223.github.io/CueBox/) in Chrome or Edge and click **Install** in the address bar. CueBox then:

- gets its own window, plus a Start menu and taskbar icon,
- works offline after the first visit,
- shows up in **Open with** for `.mkv`, `.mp4` and `.webm` files, and can be set as the default player,
- updates itself when a new version is released.

### Download a single file

Download `CueBox.html` from the [latest release](https://github.com/Alisky1223/CueBox/releases/latest), or build it yourself (see below). Then open it in Chrome or Edge. Double-clicking it works, with no server needed.

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
| `A`           | Cycle audio tracks      |
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
- Audio tracks can only be switched in MKV/WebM files, unless your browser supports `audioTracks` (Safari does). The chosen track must use a codec your browser can play: AAC, Opus, Vorbis, MP3 and FLAC work, but Chrome can't play AC3/E-AC3/DTS. Switching to a track loads it into memory, which takes a few seconds for large files.
- Whether a video plays depends on your browser's codecs. HEVC/x265 needs a GPU that can decode HEVC, with hardware acceleration turned on. Edge also needs [HEVC Video Extensions](https://apps.microsoft.com/detail/9nmzlz57r3t7) from the Microsoft Store. CueBox detects HEVC files it can't play and tells you how to fix it.

## License

[MIT](LICENSE)

## Original Contributors

- Alireza Asadi
- (My Love) Sahar Jahaniyan
