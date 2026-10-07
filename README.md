# CueBox

**Drop a file, get your subtitles.** A zero-install offline video player that finds the soft subs inside your MKV files and shows them right away.

## Features

- **Open any local video.** Use the file picker or drag and drop the file onto the page.
- **Embedded subtitles turn on automatically.** Text subtitle tracks (SRT/ASS) inside MKV/WebM files are read in the browser and shown at once, with no ffmpeg needed.
- **Add your own subtitles.** Load `.srt`, `.vtt`, `.ass` or `.ssa` files. Persian/Arabic files saved in Windows-1256 instead of UTF-8 also work.
- **Switch or turn off subtitles.** Pick any track from the dropdown, or choose **Off**.
- **100% offline.** Nothing is uploaded and there's nothing to install. It's a single HTML file.

## Usage

Open `myvideo.html` in Chrome or Edge.

You can also run the local launcher, which serves the page over http and opens your browser:

```sh
python serve.py
```

## Limitations

- Image-based subtitles (PGS, VobSub) aren't supported.
- Subtitles embedded in MP4 files aren't extracted. Load them with **Add subtitle** instead.
- Whether a video plays depends on your browser's codecs. HEVC/x265, for example, needs hardware decoding support.
