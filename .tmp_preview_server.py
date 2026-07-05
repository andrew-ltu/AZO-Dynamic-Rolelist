import http.server
import socketserver
import sys
from pathlib import Path

root = Path(r'C:\Users\Andrew\Desktop\AZO-Dynamic-Rolelist')
port = 8770

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

with socketserver.TCPServer(('127.0.0.1', port), Handler) as httpd:
    print(f'AZO role list preview  ->  http://127.0.0.1:{port}/   (Ctrl+C to stop)')
    sys.stdout.flush()
    httpd.serve_forever()
