param([switch]$Open)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot 'graphify-out/tooling/venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Graphify fehlt. Installation: siehe docs/graphify.md.'
}

$previousEncoding = $env:PYTHONIOENCODING
$previousBackend = $env:GRAPHIFY_BACKEND
Push-Location $projectRoot
try {
    $env:PYTHONIOENCODING = 'utf-8'
    $env:GRAPHIFY_BACKEND = 'none'
    & $python -m graphify extract . --code-only --max-workers 4
    if ($LASTEXITCODE -ne 0) { throw 'Graphify-Extraktion fehlgeschlagen.' }
    & $python -m graphify cluster-only .
    if ($LASTEXITCODE -ne 0) { throw 'Graphify-Ausgabe fehlgeschlagen.' }
    & $python -m graphify tree --root . --label Journal-App
    if ($LASTEXITCODE -ne 0) { throw 'Graphify-Baumansicht fehlgeschlagen.' }
    if ($Open) { Start-Process (Join-Path $projectRoot 'graphify-out/graph.html') }
}
finally {
    $env:PYTHONIOENCODING = $previousEncoding
    $env:GRAPHIFY_BACKEND = $previousBackend
    Pop-Location
}
