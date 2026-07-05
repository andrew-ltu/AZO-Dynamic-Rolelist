# serve.ps1 — tiny static server for previewing the AZO role list locally.
# The page uses fetch() to load roster.json / members.json, which browsers block
# over file://, so you need a local server. No Node/Python required.
#
#   Right-click  ->  Run with PowerShell
#   (or)  powershell -ExecutionPolicy Bypass -File serve.ps1
#
# Then open http://localhost:8770/  (it opens automatically). Ctrl+C to stop.

$preferredPort = if ($env:AZO_PORT) { [int]$env:AZO_PORT } else { 8770 }
$root = $PSScriptRoot
$python = Get-Command py -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
$node = Get-Command node -ErrorAction SilentlyContinue

if (-not $python -and -not $node) {
  Write-Host "Python or Node.js is required to run the preview server. Please install either one." -ForegroundColor Red
  exit 1
}

$port = $preferredPort
$usedPorts = @()
for ($candidate = $preferredPort; $candidate -le 8785; $candidate++) {
  try {
    $socket = [System.Net.Sockets.TcpClient]::new()
    $socket.Connect('127.0.0.1', $candidate)
    $socket.Close()
    $usedPorts += $candidate
  }
  catch {
    $port = $candidate
    break
  }
}

if ($port -gt 8785) {
  Write-Host "Could not find a free preview port between $preferredPort and 8785." -ForegroundColor Red
  exit 1
}

if ($python) {
  $serverScript = Join-Path $root '.tmp_preview_server.py'
  @"
import http.server
import socketserver
import sys
from pathlib import Path

root = Path(r'$root')
port = $port

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
"@ | Set-Content -Path $serverScript -Encoding UTF8

  Write-Host "AZO role list preview  ->  http://localhost:$port/   (Ctrl+C to stop)" -ForegroundColor Cyan
  try { Start-Process "http://localhost:$port/" } catch {}
  & $python.Source $serverScript
} else {
  $serverScript = Join-Path $root '.tmp_preview_server.js'
  $env:AZO_PORT = $port
  $env:AZO_ROOT = $root
  @'
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.AZO_PORT, 10) || 8770;
const PUBLIC_DIR = process.env.AZO_ROOT;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  let filePath = path.join(PUBLIC_DIR, urlPath);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`AZO role list preview  ->  http://127.0.0.1:${PORT}/   (Ctrl+C to stop)`);
});
'@ | Set-Content -Path $serverScript -Encoding UTF8

  Write-Host "AZO role list preview  ->  http://localhost:$port/   (Ctrl+C to stop)" -ForegroundColor Cyan
  try { Start-Process "http://localhost:$port/" } catch {}
  & $node.Source $serverScript
}
