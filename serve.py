"""Optional local launcher. The page picks videos/subtitles itself and also works
opened directly via file://; this just serves it over http and opens the browser."""
import http.server, os, socketserver, sys, webbrowser

PORT = 8321
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    url = f'http://127.0.0.1:{PORT}/myvideo.html'
    print(f'serving {url}', flush=True)
    if '--no-open' not in sys.argv:
        webbrowser.open(url)
    Server(('127.0.0.1', PORT), Handler).serve_forever()
