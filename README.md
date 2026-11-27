# CueBox

[![CI](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml/badge.svg)](https://github.com/Alisky1223/CueBox/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Drop a file, get your subtitles.** A zero-install offline video player that finds the soft subs inside your MKV files and shows them right away.

![CueBox playing a video with subtitles](docs/screenshots/desktop.png)

## Features

- **Open any local video.** Use the file picker or drag and drop the file onto the page.
- **Play from a link.** Paste a direct link to a video file and it streams without downloading the whole file first.
- **Embedded subtitles turn on automatically.** Text subtitle tracks (SRT/ASS/SSA/WebVTT) inside MKV/WebM files are read in the browser and shown at once, with no ffmpeg needed.
- **Add your own subtitles.** Load `.srt`, `.vtt`, `.ass` or `.ssa` files. Persian/Arabic files saved in Windows-1256 instead of UTF-8 also work.
- **Switch or turn off subtitles.** Pick any track from the subtitle menu, or choose **Off**. You can also change the subtitle size and background, and shift timing when subtitles are out of sync.
- **Switch audio tracks.** Videos with several audio tracks (for example, multiple dubs) get an audio menu. In MKV/WebM files, CueBox reads the chosen track itself, so this works in Chrome and Edge without any flags.
- **A polished player.** It has a dark cinematic theme, a seek bar that previews the time, speed control, picture-in-picture and fullscreen. Controls hide on their own while the video plays.
- **Watch together.** Pair with someone on another device using a short code, and play, pause, seeking and speed stay in sync. Chat, send emoji reactions and talk while you watch. Each of you plays your own copy of the video.
- **Offline playback.** The build is a single HTML file. **Watch together** and **Play from a link** use the network. Your local video files stay on your device.

## Usage

### Install on a computer (recommended)

Open [alisky1223.github.io/CueBox](https://alisky1223.github.io/CueBox/) in Chrome or Edge and click **Install** in the address bar. CueBox then:

- gets its own window, plus a Start menu and taskbar icon,
- works offline after the first visit,
- shows up in **Open with** for `.mkv`, `.mp4` and `.webm` files, and can be set as the default player,
- updates itself when a new version is released.

### Install on a phone

Open [alisky1223.github.io/CueBox](https://alisky1223.github.io/CueBox/) on your phone, then:

- **Android (Chrome):** tap the **⋮** menu, then **Install app** (on some phones it's called **Add to Home screen**), then **Install**.
- **iPhone/iPad (Safari):** tap **Share**, then **Add to Home Screen**, then **Add**. On iOS 16.4 or newer, Chrome and Edge have the same option in their Share menu.

CueBox gets a home-screen icon and opens full screen. Tap the folder button to pick a video from your phone. Like on a computer, it works offline after the first visit.

<p>
  <img src="docs/screenshots/phone-start.png" alt="CueBox start screen on a phone" width="220" />
  <img src="docs/screenshots/phone-playing.png" alt="CueBox playing a video on a phone in landscape" width="476" />
</p>

### Download a single file

Download `CueBox.html` from the [latest release](https://github.com/Alisky1223/CueBox/releases/latest), or build it yourself (see below). Then open it in Chrome or Edge. Double-clicking it works, with no server needed.

> The `index.html` in the repo root is the development source and won't run when opened directly. Use `dist/index.html` or `pnpm dev` instead.

### Play from a link

Paste a link into the box under **Drop a video here** and press **Play**. While a video is open, use **Open link** in the top bar or press `U`.

- The link must point straight to a video file (for example `https://example.com/movie.mp4`), not a web page such as YouTube.
- The video plays as a stream, so it starts right away.
- Embedded subtitles aren't loaded from links, since finding them means downloading the whole file. Add a subtitle file or a subtitle link instead.
- **Add subtitle from link…** (subtitle menu) needs a server that allows CORS. **Add audio from link…** (audio menu) plays a separate audio file, such as a dub, in sync with the video from any server. If the video's own server doesn't allow CORS, its original sound comes back only after reopening the video.
- Audio-track switching and the HEVC warning need to read the file itself. That works only if the server allows it ([CORS](https://developer.mozilla.org/docs/Web/HTTP/CORS) with range requests). Otherwise the video still plays.
- The online version runs over https, so `http://` links may be blocked by the browser.

### Watch together

1. You and your partner each open your own copy of the same video.
2. One of you clicks the **Watch together** button (two people) in the player controls, then **Create a code**, and sends the code to the other person.
3. The other person opens **Watch together**, types the code and clicks **Join**.

From then on, play, pause, seeking and speed changes on either side apply to both players. CueBox warns you if the two videos have different lengths. The CueBox WebSocket relay carries playback commands, text chat, reactions and the signals needed to connect voice chat. Voice audio uses WebRTC by default.

Once connected, the **Chat** button (speech bubble) opens a chat panel over the video, also in fullscreen. Type a message, or tap an emoji to send a reaction that floats up on both screens. Set your name at the top of the panel. Messages that arrive while the panel is closed pop up briefly over the video. Chat isn't saved anywhere.

![Watch together chat with emoji reactions](docs/screenshots/watch-together-chat.png)

The **Mic** button turns on voice chat (your browser asks for the microphone the first time). Pick the mode with the **Open mic** / **Push to talk** switch at the top right (also under **Voice** in the **Watch together** menu):

- **Open mic**: click the mic button (or press `V`) to turn the mic on or off. Only sound louder than the **Threshold** is sent, so background noise stays out. Speak and move the marker just above the noise on the level bar.
- **Push to talk**: hold the mic button or `V` while you talk. Handy in public places.

While your partner talks, the movie gets quieter (turn off **Lower movie while partner talks** to keep it as is). You can also set your partner's volume there. Use headphones if you can, since speakers can leak the movie into your mic.

If WebRTC is unavailable, both viewers can select **Cloudflare voice relay** under **Watch together → Network settings** before joining. Mic audio then passes through the same relay as text chat.

### Keyboard shortcuts

| Key           | Action                                       |
| ------------- | -------------------------------------------- |
| `Space` / `K` | Play / pause                                 |
| `←` / `→`     | Seek 5s                                      |
| `J` / `L`     | Seek 10s                                     |
| `↑` / `↓`     | Volume                                       |
| `M`           | Mute                                         |
| `F`           | Fullscreen                                   |
| `C`           | Cycle subtitle tracks                        |
| `A`           | Cycle audio tracks                           |
| `G` / `H`     | Subtitle delay −/+ 0.1s                      |
| `O`           | Open video                                   |
| `U`           | Play from a link                             |
| `V`           | Mic on/off, or hold to talk (Watch together) |

### Phone gestures

| Gesture (on the video)    | Action           |
| ------------------------- | ---------------- |
| Drag up/down on the right | Volume           |
| Drag up/down on the left  | Video brightness |
| Drag left/right           | Seek             |
| Tap                       | Show controls    |

## Development

You need Node 20 or newer, with Corepack enabled (`corepack enable`).

```sh
pnpm install
pnpm dev      # dev server at http://localhost:5173
pnpm test     # unit tests
pnpm build    # outputs dist/index.html (single self-contained file)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow and project layout.

CueBox defaults to its hosted Watch together relay. To test a local Worker, run `pnpm exec wrangler dev --config worker/wrangler.jsonc --local` and set `VITE_PARTY_RELAY_URL=ws://127.0.0.1:8787/ws` in the environment before starting Vite or building the HTML. Open the resulting page in two tabs on the same computer and join the same room.

To use a relay on your own Cloudflare account, run `pnpm exec wrangler deploy --config worker/wrangler.jsonc` and set `VITE_PARTY_RELAY_URL` to the resulting `wss://…/ws` endpoint before building CueBox. For GitHub releases, set the repository variable of the same name.

## Limitations

- Image-based subtitles (PGS, VobSub) aren't supported.
- Subtitles embedded in MP4 files aren't extracted. Load them with **Add subtitle** instead.
- Audio tracks can only be switched in MKV/WebM files, unless your browser supports `audioTracks` (Safari does). The chosen track must use a codec your browser can play: AAC, Opus, Vorbis, MP3 and FLAC work, but Chrome can't play AC3/E-AC3/DTS. Switching to a track loads it into memory, which takes a few seconds for large files.
- On phones, you open videos from inside CueBox. It doesn't show up in the file manager's **Open with** menu.
- iPhone and iPad can't play MKV files at all, so only MP4 and WebM work there. Android plays MKV.
- The brightness gesture changes the video's picture, not the phone's screen brightness. Browsers can't set that.
- The volume gesture doesn't work on iPhone and iPad, where only the hardware buttons change volume.
- Subtitle and audio track extraction reads the whole file, which can be slow for large MKVs on phones with little memory.
- Whether a video plays depends on your browser's codecs. HEVC/x265 needs a GPU that can decode HEVC, with hardware acceleration turned on. Edge also needs [HEVC Video Extensions](https://apps.microsoft.com/detail/9nmzlz57r3t7) from the Microsoft Store. CueBox detects HEVC files it can't play and tells you how to fix it.
- **Watch together** needs access to the CueBox WebSocket relay. On networks where voice cannot connect through STUN, you can add a TURN server under **Network settings**.

## License

[MIT](LICENSE)

## Original Contributors

- Alireza Asadi
- (My Love) Sahar Jahaniyan
