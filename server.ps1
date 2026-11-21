# RE:START - tiny dependency-free local game server.
# Uses a raw TCP listener (no admin rights / URL ACL needed), serves this
# folder, and opens the game in the default browser.

param(
  [int]$Port = 8137,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
if (-not $root.EndsWith('\')) { $root += '\' }

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.glb'  = 'model/gltf-binary'
  '.gltf' = 'model/gltf+json'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.wasm' = 'application/wasm'
  '.mp4'  = 'video/mp4'
  '.webm' = 'video/webm'
  '.txt'  = 'text/plain; charset=utf-8'
  '.bin'  = 'application/octet-stream'
}

$listener = $null
$chosen = $Port
for ($i = 0; $i -lt 20; $i++) {
  try {
    $candidate = $Port + $i
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidate)
    $listener.Start()
    $chosen = $candidate
    break
  } catch {
    if ($listener) { try { $listener.Stop() } catch {} }
    $listener = $null
  }
}
if (-not $listener) {
  Write-Host 'Could not open a local port for the game.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$url = "http://127.0.0.1:$chosen/"
Write-Host ''
Write-Host '  RE:START - A Bounce Back Game' -ForegroundColor Yellow
Write-Host "  Serving: $root"
Write-Host "  Game URL: $url" -ForegroundColor Cyan
Write-Host '  Press Ctrl+C in this window to stop the game server.'
Write-Host ''

if (-not $NoBrowser) {
  try { Start-Process $url } catch { Write-Host 'Open the URL above in Chrome or Edge.' -ForegroundColor Yellow }
}

function Write-Response($stream, [string]$status, [string]$type, [byte[]]$body) {
  $header = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()
      $buffer = New-Object byte[] 8192
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { continue }
      $request = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
      $firstLine = ($request -split "`r`n")[0]
      $parts = $firstLine -split ' '
      $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
      $pathOnly = $rawPath.Split('?')[0]
      try { $pathOnly = [System.Uri]::UnescapeDataString($pathOnly) } catch {}
      if ($pathOnly -eq '/' -or $pathOnly -eq '') { $pathOnly = '/index.html' }
      $relative = $pathOnly.TrimStart('/').Replace('/', '\')
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

      if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
        Write-Response $stream '403 Forbidden' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes('Forbidden'))
        continue
      }
      if (-not [System.IO.File]::Exists($full)) {
        Write-Response $stream '404 Not Found' 'text/plain; charset=utf-8' ([System.Text.Encoding]::UTF8.GetBytes("Not found: $pathOnly"))
        continue
      }
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      Write-Response $stream '200 OK' $type $bytes
    } catch {
      # A dropped connection must never bring the server down.
    } finally {
      try { $client.Close() } catch {}
    }
  }
} finally {
  try { $listener.Stop() } catch {}
}
