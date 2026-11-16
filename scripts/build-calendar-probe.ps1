$ErrorActionPreference = 'Stop'
# npm tests exercise the actual Rust commands, with no user vault or WebView.
if (!$env:VCToolsInstallDir) {
  $vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
  $installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (!$installation) { throw 'Visual Studio C++ build tools are required for calendar integration tests.' }
  Import-Module "$installation/Common7/Tools/Microsoft.VisualStudio.DevShell.dll"
  Enter-VsDevShell -VsInstallPath $installation -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
}
cargo build --manifest-path "$PSScriptRoot/../src-tauri/Cargo.toml" --bin calendar-probe
if ($LASTEXITCODE -ne 0) { throw 'Calendar test harness build failed.' }
