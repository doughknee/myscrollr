param(
  [string]$TargetRoot = (Join-Path $PSScriptRoot "../src-tauri/target/release")
)

$ErrorActionPreference = "Stop"

$app = Join-Path $TargetRoot "scrollr-desktop.exe"
$nsis = @(Get-ChildItem -LiteralPath (Join-Path $TargetRoot "bundle/nsis") -Filter "*.exe" -File -ErrorAction SilentlyContinue)
$msi = @(Get-ChildItem -LiteralPath (Join-Path $TargetRoot "bundle/msi") -Filter "*.msi" -File -ErrorAction SilentlyContinue)

if (-not (Test-Path -LiteralPath $app -PathType Leaf) -or $nsis.Count -eq 0 -or $msi.Count -eq 0) {
  throw "Expected signed application, NSIS installer, and MSI installer were not all produced."
}

$files = @((Get-Item -LiteralPath $app)) + $nsis + $msi
$publishers = @()
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Invalid Authenticode signature on $($file.Name): $($signature.Status)"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "Missing RFC3161 timestamp on $($file.Name)"
  }
  $publishers += $signature.SignerCertificate.Subject
}

$uniquePublishers = @($publishers | Sort-Object -Unique)
if ($uniquePublishers.Count -ne 1) {
  throw "Windows artifacts were signed by different publishers."
}

$config = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "../src-tauri/tauri.conf.json") | ConvertFrom-Json
$publicKeyText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($config.plugins.updater.pubkey))
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("scrollr-updater-verify-" + [guid]::NewGuid().ToString("N"))
$publicKeyFile = Join-Path $tempRoot "minisign.pub"

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  [System.IO.File]::WriteAllText($publicKeyFile, $publicKeyText)
  foreach ($installer in $nsis + $msi) {
    $signatureFile = "$($installer.FullName).sig"
    if (-not (Test-Path -LiteralPath $signatureFile -PathType Leaf)) {
      throw "Missing Tauri updater signature for $($installer.Name)"
    }
    $decodedSignatureFile = Join-Path $tempRoot "$($installer.Name).minisig"
    [System.IO.File]::WriteAllBytes($decodedSignatureFile, [Convert]::FromBase64String([System.IO.File]::ReadAllText($signatureFile).Trim()))
    $null = & minisign -Vm $installer.FullName -p $publicKeyFile -x $decodedSignatureFile 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri updater signature does not match $($installer.Name)"
    }
  }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Verified $($files.Count) Authenticode signatures and $($nsis.Count + $msi.Count) updater signatures."
Write-Host "Publisher: $($uniquePublishers[0])"
