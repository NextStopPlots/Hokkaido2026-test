from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler


BUILD_VERSION = "255"


class NoCacheHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _redirect_root(self):
        self.send_response(302)
        self.send_header("Location", f"/index.html?v={BUILD_VERSION}")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        # Always enter through a versioned index URL so a mobile browser cannot
        # reuse a stale/offline root document from a previous preview session.
        if self.path in ("/", ""):
            self._redirect_root()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path in ("/", ""):
            self._redirect_root()
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


server = ThreadingHTTPServer(("0.0.0.0", 8000), NoCacheHandler)
print(f"No-cache server running at http://0.0.0.0:8000 (build {BUILD_VERSION})")
server.serve_forever()
