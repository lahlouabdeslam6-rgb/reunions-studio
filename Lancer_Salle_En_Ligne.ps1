$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (!$node) { $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (!(Test-Path -LiteralPath $node -PathType Leaf)) { throw 'Installez Node.js 20 ou plus recent.' }
& $node server.js --online --open
if ($LASTEXITCODE -ne 0) { throw 'Fermez toute ancienne instance de Reunions Studio et reessayez.' }
