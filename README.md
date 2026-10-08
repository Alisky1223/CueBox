# CueBox

[![CI](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Drop a file, get your subtitles.** A zero-install offline video player that finds the soft subs inside your MKV files and shows them right away.

<!-- TODO: add screenshot at docs/screenshot.png -->

## Features

- **Open any local video.** Use the file picker or drag and drop the file onto the page.
- **Embedded subtitles turn on automatically.** Text subtitle tracks (SRT/ASS/SSA/WebVTT) inside MKV/WebM files are read in the browser and shown at once, with no ffmpeg needed.
- **Add your own subtitles.** Load `.srt`, `.vtt`, `.ass` or `.ssa` files. Persian/Arabic files saved in Windows-1256 instead of UTF-8 also work.
- **Switch or turn off subtitles.** Pick any track from the dropdown, or choose **Off**.
- **100% offline.** Nothing is uploaded and there's nothing to install. The build is a single HTML file.

## Usage

Download `index.html` from the latest [CI run](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml) (artifact **cuebox**), or build it yourself (see below). Then open it in Chrome or Edge. Double-clicking it works, with no server needed.

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
