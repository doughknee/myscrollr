$ErrorActionPreference = "Stop"

if (-not $IsWindows) { throw "Windows signing tools can only be installed on Windows." }

Install-Module -Name ArtifactSigning -RequiredVersion "0.1.8" -Scope CurrentUser -Force -Repository PSGallery
$module = Get-Module -ListAvailable -FullyQualifiedName @{ ModuleName = "ArtifactSigning"; ModuleVersion = "0.1.8" } |
  Select-Object -First 1
if (-not $module) { throw "ArtifactSigning 0.1.8 was not installed." }

$moduleSignature = Get-AuthenticodeSignature -LiteralPath (Join-Path $module.ModuleBase "ArtifactSigning.psm1")
if ($moduleSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
    $moduleSignature.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
  throw "ArtifactSigning 0.1.8 does not have a valid Microsoft signature."
}

function Install-VerifiedNugetPackage([string]$Name, [string]$Version) {
  $lowerName = $Name.ToLowerInvariant()
  $packageFile = Join-Path $tempRoot "$lowerName.$Version.nupkg"
  Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/$lowerName/$Version/$lowerName.$Version.nupkg" -OutFile $packageFile

  & $nuget verify -Signatures $packageFile -NonInteractive -ForceEnglishOutput
  if ($LASTEXITCODE -ne 0) { throw "$Name $Version does not have a valid NuGet package signature." }

  $packageRoot = Join-Path $env:LOCALAPPDATA "ArtifactSigning/$Name"
  $installPath = Join-Path $packageRoot "$Name.$Version"
  New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
  if (Test-Path -LiteralPath $installPath) {
    Remove-Item -LiteralPath $installPath -Recurse -Force
  }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($packageFile, $installPath)
}

$archiveName = "minisign-0.12-win64.zip"
$expectedSha256 = "37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("scrollr-minisign-" + [guid]::NewGuid().ToString("N"))
$archive = Join-Path $tempRoot $archiveName
$nuget = Join-Path $tempRoot "nuget-7.9.0.exe"

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  Invoke-WebRequest "https://dist.nuget.org/win-x86-commandline/v7.9.0/nuget.exe" -OutFile $nuget
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $nuget).Hash -ne "992D70CAC5B06C38EFEC91806CABA64CDCC07E6D963A0959DBBBAF264D33B800") {
    throw "NuGet CLI checksum mismatch."
  }
  $nugetSignature = Get-AuthenticodeSignature -LiteralPath $nuget
  if ($nugetSignature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
      $nugetSignature.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
    throw "NuGet CLI does not have a valid Microsoft signature."
  }

  Install-VerifiedNugetPackage "Microsoft.Windows.SDK.BuildTools" "10.0.26100.4188"
  Install-VerifiedNugetPackage "Microsoft.ArtifactSigning.Client" "1.0.128"
  Install-VerifiedNugetPackage "sign" "0.9.1-beta.26227.3"

  Invoke-WebRequest "https://github.com/jedisct1/minisign/releases/download/0.12/$archiveName" -OutFile $archive
  $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) { throw "minisign archive checksum mismatch." }

  Expand-Archive -LiteralPath $archive -DestinationPath $tempRoot
  $cargoHome = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) ".cargo" }
  $binDirectory = Join-Path $cargoHome "bin"
  New-Item -ItemType Directory -Force -Path $binDirectory | Out-Null
  Copy-Item -LiteralPath (Join-Path $tempRoot "minisign-win64/x86_64/minisign.exe") -Destination (Join-Path $binDirectory "minisign.exe") -Force

  if ($env:GITHUB_PATH) {
    [System.IO.File]::AppendAllText($env:GITHUB_PATH, "$binDirectory$([Environment]::NewLine)")
  }
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Import-Module ArtifactSigning -RequiredVersion "0.1.8" -ErrorAction Stop
Get-Command Invoke-ArtifactSigning -ErrorAction Stop | Out-Null
minisign -v
