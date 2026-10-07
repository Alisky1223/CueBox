"""Local player server. Browsers refuse subtitle tracks on file:// pages, so the
page and the video are served over http instead."""
import http.server, mimetypes, os, socketserver, sys, urllib.parse, webbrowser

VIDEO = r"E:\Tasiyan-E01-360.mp4"
PORT = 8321
ROOT = os.path.dirname(os.path.abspath(__file__))

mimetypes.add_type('text/vtt', '.vtt')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == '/video':
            return self.send_video()
        return super().do_GET()

    # Range support: without it the browser cannot seek in a 500 MB file.
    def send_video(self):
        size = os.path.getsize(VIDEO)
        ctype = mimetypes.guess_type(VIDEO)[0] or 'video/x-matroska'
        rng = self.headers.get('Range')
        start, end = 0, size - 1
        if rng and rng.startswith('bytes='):
            a, _, b = rng[6:].partition('-')
            start = int(a) if a else 0
            end = int(b) if b else size - 1
        end = min(end, size - 1)
        self.send_response(206 if rng else 200)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if rng:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.end_headers()
        with open(VIDEO, 'rb') as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(262144, left))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                    return
                left -= len(chunk)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    url = f'http://127.0.0.1:{PORT}/myvideo.html'
    print(f'serving {url}  (video: {VIDEO})', flush=True)
    if '--no-open' not in sys.argv:
        webbrowser.open(url)
    Server(('127.0.0.1', PORT), Handler).serve_forever()
