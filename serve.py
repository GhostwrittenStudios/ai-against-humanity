"""Dev server for AI Against Humanity.

Same as `python -m http.server` but sends no-cache headers so edits always
show up on reload (plain http.server lets browsers cache heuristically),
and listens on all interfaces so a phone on the same network can connect.
"""
import functools
import http.server
import os

PORT = int(os.environ.get("PORT", 8123))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("0.0.0.0", PORT), handler) as srv:
        print(f"AI Against Humanity: http://localhost:{PORT}")
        srv.serve_forever()
