param([string]$NotesFile)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$configuration = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
$version = $configuration.version
$package = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json
$cargo = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw
if ($package.version -ne $version -or $cargo -notmatch ('(?m)^version\s*=\s*"' + [regex]::Escape($version) + '"\s*$')) {
  throw 'Die Versionsnummern in package.json, Cargo.toml und tauri.conf.json müssen übereinstimmen.'
}
$keyPath = Join-Path $projectRoot '.release-keys/journal-release.key'
$passwordPath = Join-Path $projectRoot '.release-keys/journal-release.password.dpapi'
$previousKey = $env:TAURI_SIGNING_PRIVATE_KEY
$previousPassword = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
$env:PATH = (Join-Path $env:USERPROFILE '.cargo/bin') + ';' + $env:PATH
try {
  if (!$env:TAURI_SIGNING_PRIVATE_KEY) {
    if (!(Test-Path -LiteralPath $keyPath)) { throw 'Release-Schlüssel fehlt. TAURI_SIGNING_PRIVATE_KEY setzen oder den gesicherten Schlüssel bereitstellen.' }
    $env:TAURI_SIGNING_PRIVATE_KEY = $keyPath
    # ConvertFrom-SecureString's Windows format is a hex-encoded CurrentUser DPAPI blob.
    # Use the OS API directly: inherited PowerShell 7 module paths can break the
    # Security module in Windows PowerShell 5.1 when npm starts this script.
    Add-Type -AssemblyName System.Security
    $protected = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
    if ($protected -notmatch '\A(?:[0-9a-fA-F]{2})+\z') { throw 'Invalid DPAPI password file.' }
    $protectedBytes = New-Object byte[] ($protected.Length / 2)
    for ($i = 0; $i -lt $protectedBytes.Length; $i++) { $protectedBytes[$i] = [Convert]::ToByte($protected.Substring($i * 2, 2), 16) }
    $passwordBytes = [Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [Text.Encoding]::Unicode.GetString($passwordBytes) }
    finally { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
  }
  # Tauri adds the app version to the signature's authenticated trusted comment.
  & npm.cmd run tauri build -- --config src-tauri/tauri.updater.conf.json
  if ($LASTEXITCODE -ne 0) { throw "Release-Build fehlgeschlagen ($LASTEXITCODE)." }
  $installers = @(Get-ChildItem -LiteralPath 'src-tauri/target/release/bundle/nsis' -Filter "*_${version}_x64-setup.exe" -File)
  if ($installers.Count -ne 1) { throw 'Kein eindeutiger x64-Installer für diese Version gefunden.' }
  $installer = $installers[0]
  $signature = Get-Content -LiteralPath ($installer.FullName + '.sig') -Raw
  $signedComment = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($signature.Trim()))
  if ($signedComment -notmatch ('(?m)^trusted comment:.*\bversion:' + [regex]::Escape($version) + '(?:\s|$)')) { throw 'Die Signatur enthält keine passende App-Version.' }
  $notes = if ($NotesFile) { Get-Content -LiteralPath $NotesFile -Raw -Encoding UTF8 } else { "Journal $version" }
  $output = Join-Path $projectRoot 'src-tauri/target/release/update'
  New-Item -ItemType Directory -Path $output -Force | Out-Null
  $manifest = [ordered]@{
    version = $version
    notes = $notes
    pub_date = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    platforms = @{
      'windows-x86_64' = @{
        signature = $signature.Trim()
        url = 'https://github.com/M10-Voxel/Journal-App/releases/download/v' + $version + '/' + [Uri]::EscapeDataString($installer.Name)
      }
    }
  }
  [IO.File]::WriteAllText((Join-Path $output 'latest.json'), ($manifest | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  Copy-Item -LiteralPath $installer.FullName -Destination $output
  Copy-Item -LiteralPath ($installer.FullName + '.sig') -Destination $output
  Copy-Item -LiteralPath 'src-tauri/target/release/journal-app.exe' -Destination $output
  & node scripts/verify-update.mjs $output
  if ($LASTEXITCODE -ne 0) { throw 'Update verification failed.' }
  Write-Host "Release-Dateien: $output"
  Write-Host "EXE, Installer, .sig und latest.json als Assets an GitHub-Release v$version anhängen. Es wurde nichts veröffentlicht."
} finally {
  $env:TAURI_SIGNING_PRIVATE_KEY = $previousKey
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $previousPassword
}
