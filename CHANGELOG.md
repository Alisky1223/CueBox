# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-09

### Added

- New interface with a dark cinematic theme, a drop-zone start screen and toast notifications.
- Custom player controls: seek bar with time preview, ±10s buttons, volume, speed, picture-in-picture and fullscreen. Controls hide on their own during playback.
- Subtitle menu with track picker, size, background style and timing delay.
- Audio track menu (`A` to cycle) for videos with multiple dubs. It uses the browser's `audioTracks` where available. Otherwise it extracts the track from the MKV/WebM and plays it in sync with the video.
- Keyboard shortcuts.
- Volume and subtitle style are remembered between sessions.
- HEVC/x265 videos the browser can't decode now show steps to enable HEVC playback instead of a black picture or a generic error.

### Fixed

- Opening the source `index.html` directly made the page, including Open video, do nothing. It now shows a message explaining how to run CueBox.

## [0.1.0] - 2026-10-08

### Added

- Open local videos with the file picker or drag and drop.
- Embedded text subtitles (SRT/ASS/SSA/WebVTT) in MKV/WebM are extracted in the browser and turned on automatically.
- Load external `.srt`, `.vtt`, `.ass` and `.ssa` subtitles, with Windows-1256 and UTF-16 detection.
- Subtitle track picker with an **Off** option.
- Single-file offline build, plus unit tests, linting and CI.

### Fixed

- Embedded ASS subtitles showed raw event text instead of the dialogue.
