$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$node) { $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (!(Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Installez Node.js 20 ou plus recent.' }
$cloudflared = (Get-Command cloudflared.exe -ErrorAction SilentlyContinue).Source
if (!$cloudflared -and (Test-Path -LiteralPath '.tools/cloudflared.exe')) { $cloudflared = (Resolve-Path -LiteralPath '.tools/cloudflared.exe').Path }
if (!$cloudflared) { throw 'Installez cloudflared ou placez cloudflared.exe dans le dossier .tools.' }
$logs = (New-Item -ItemType Directory -Force -Path '.tools').FullName
$nonce = [guid]::NewGuid().ToString('N')
$tunnelLog = Join-Path $logs "$nonce-tunnel.log"
$tunnelOut = Join-Path $logs "$nonce-tunnel-out.log"
$env:REUNIONS_PORT = '8468'
$env:REUNIONS_GUEST_PORT = '8467'
$tunnel = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--protocol','http2','--url','http://127.0.0.1:8467') -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelLog -PassThru
try {
    $url = $null
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        Start-Sleep -Milliseconds 500
        $log = Get-Content -LiteralPath $tunnelLog -Raw
        if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $url = $Matches[0]; break }
        if ($tunnel.HasExited) { break }
    }
    if (!$url) { throw 'Lien HTTPS indisponible. Verifiez Internet et le journal dans .tools.' }
    $env:REUNIONS_PUBLIC_URL = $url
    & $node server.js --open
    if ($LASTEXITCODE -ne 0) { throw 'Demarrage impossible. Fermez toute ancienne instance qui utilise le port 8468.' }
} finally {
    if (!$tunnel.HasExited) { Stop-Process -Id $tunnel.Id -ErrorAction SilentlyContinue }
}
