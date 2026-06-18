# serve.ps1 — tiny static server for previewing the AZO role list locally.
# The page uses fetch() to load roster.json / members.json, which browsers block
# over file://, so you need a local server. No Node/Python required.
#
#   Right-click  ->  Run with PowerShell
#   (or)  powershell -ExecutionPolicy Bypass -File serve.ps1
#
# Then open http://localhost:8770/  (it opens automatically). Ctrl+C to stop.

$port = 8770
$root = $PSScriptRoot
$mime = @{
  '.html'='text/html; charset=utf-8'; '.json'='application/json; charset=utf-8'
  '.js'='text/javascript'; '.css'='text/css'; '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'
  '.wav'='audio/wav'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'
  '.gif'='image/gif'; '.svg'='image/svg+xml'; '.webp'='image/webp'; '.ico'='image/x-icon'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() }
catch { Write-Host "Could not bind port $port. Is the server already running?" -ForegroundColor Red; exit 1 }

Write-Host "AZO role list preview  ->  http://localhost:$port/   (Ctrl+C to stop)" -ForegroundColor Cyan
try { Start-Process "http://localhost:$port/" } catch {}

while ($listener.IsListening) {
  try {
    $ctx  = $listener.GetContext()
    $path = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $file = Join-Path $root $path

    if (Test-Path $file -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ct  = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ctx.Response.ContentType = $ct
      $ctx.Response.Headers.Add('Cache-Control','no-store')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.OutputStream.Close()
  } catch {}
}
