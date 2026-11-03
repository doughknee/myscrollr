# CI only: install the signed NSIS package into the disposable runner.
$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne "true") { throw "This test installs into a disposable CI runner only." }
$desktop = Split-Path $PSScriptRoot -Parent
$report = Join-Path $desktop "package-smoke"
New-Item -ItemType Directory -Force -Path $report | Out-Null
$installer = @(Get-ChildItem -LiteralPath (Join-Path $desktop "src-tauri/target/release/bundle/nsis") -Filter "*-setup.exe")
if ($installer.Count -ne 1) { throw "Expected exactly one NSIS installer." }
$install = Start-Process -FilePath $installer[0].FullName -ArgumentList '/S' -PassThru -WindowStyle Hidden
if (-not $install.WaitForExit(120000)) { $install.Kill(); throw "Installer timed out." }
if ($install.ExitCode -ne 0) { throw "Installer failed: $($install.ExitCode)" }
$installed = Join-Path $env:LOCALAPPDATA "Scrollr/scrollr-desktop.exe"
if (-not (Test-Path -LiteralPath $installed)) { throw "Installed application missing: $installed" }
$original = Join-Path $desktop "src-tauri/target/release/scrollr-desktop.exe"
$signature = Get-AuthenticodeSignature -LiteralPath $installed
$buildSignature = Get-AuthenticodeSignature -LiteralPath $original
if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or $signature.SignerCertificate.Subject -ne $buildSignature.SignerCertificate.Subject) { throw "Installed application signature/publisher mismatch." }
# The standalone executable is re-signed after bundling, so its timestamp and
# whole-file hash can differ from the signed copy embedded in the installer.
Get-FileHash -LiteralPath $installed | Format-List | Out-String | Set-Content -LiteralPath (Join-Path $report 'installed-hash.txt')
$app = Start-Process -FilePath $installed -PassThru -WindowStyle Hidden
try {
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $app.Refresh()
    if ($app.HasExited) { throw "Installed application exited during startup: $($app.ExitCode)" }
  }
  # Window existence is a native startup smoke check, not rendered-content proof.
  $app.Refresh()
  if ($app.MainWindowHandle -eq 0) { throw "Installed app created no main window." }
  "NSIS install succeeded; installed signature, timestamp and publisher verified; app survived 30 seconds with a native window. Not an updater or physical-display test." | Set-Content -LiteralPath (Join-Path $report 'result.txt')
} finally {
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
}
