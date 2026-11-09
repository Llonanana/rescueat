"""
本機預覽用的網頁伺服器：每次都回傳最新檔案，避免瀏覽器把新舊版本的程式混在一起用。
執行：python scripts/serve.py   然後打開 http://127.0.0.1:5500/
"""
import functools
import http.server
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = 5500


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    print(f"RescuEat 預覽：http://127.0.0.1:{PORT}/  （按 Ctrl+C 停止）")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), functools.partial(NoCacheHandler, directory=str(ROOT))).serve_forever()
