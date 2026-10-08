# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-08

### Added

- Open local videos with the file picker or drag and drop.
- Embedded text subtitles (SRT/ASS/SSA/WebVTT) in MKV/WebM are extracted in the browser and turned on automatically.
- Load external `.srt`, `.vtt`, `.ass` and `.ssa` subtitles, with Windows-1256 and UTF-16 detection.
- Subtitle track picker with an **Off** option.
- Single-file offline build, plus unit tests, linting and CI.

### Fixed

- Embedded ASS subtitles showed raw event text instead of the dialogue.
