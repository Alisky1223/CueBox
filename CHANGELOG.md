# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Phone gestures**: over the video, drag up or down on the right side for volume (not on iPhone/iPad, where only the hardware buttons change it) or on the left side for video brightness, and drag sideways to seek. Brightness changes the picture only, not the phone's screen setting, and is remembered.

### Changed

- On phones, tapping the video shows the controls instead of pausing. Use the play button to pause.

## [0.6.0] - 2026-10-28

### Added

- **Watch together chat**: once connected, the chat button opens a panel over the video (works in fullscreen) to message your partner and send quick emoji reactions. Messages that arrive while the panel is closed pop up briefly over the video. Set a name in the panel to show it to your partner. Chat goes directly between the two browsers and isn't saved.

## [0.5.0] - 2026-10-28

### Added

- **Play from a link**: paste a direct link to a video file on the start screen, or use **Open link** (`U`) in the top bar, and it streams right away. Embedded audio tracks and the HEVC check also work when the server allows CueBox to read the file (CORS with range requests); embedded subtitles aren't scanned for links.
- **Subtitle and audio from a link**: **Add subtitle from link…** in the subtitle menu and **Add audio from link…** in the audio menu (e.g. a separately hosted dub, played in sync with the video). Subtitle links need a server that allows CORS.

## [0.4.0] - 2026-10-16

### Added

- **Watch together**: pair with someone on another device using a short code. Play, pause, seeking and speed stay in sync while each of you plays your own copy of the video. Needs internet; only playback commands are sent.

## [0.3.0] - 2026-10-09

### Added

- Installable app (PWA) at [alisky1223.github.io/CueBox](https://alisky1223.github.io/CueBox/). It works offline and opens `.mkv`, `.mp4` and `.webm` files from the OS.

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
