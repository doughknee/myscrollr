$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "sign-windows.ps1"
$fakeSigner = Join-Path $PSScriptRoot "testdata/fake-artifact-signing.ps1"
$required = @(
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_CODE_SIGNING_ACCOUNT_NAME",
  "AZURE_CODE_SIGNING_CERT_PROFILE_NAME",
  "AZURE_CODE_SIGNING_ENDPOINT"
)

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Invoke-Signer([string]$Path) {
  & pwsh -NoProfile -File $scriptPath -FilePath $Path -TestCommand $fakeSigner 2>&1 | Out-Null
  return $LASTEXITCODE
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "Scrollr signing tests"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
$signedInput = Join-Path $tempRoot "signed input with spaces.exe"
$argsFile = Join-Path $tempRoot "arguments.json"
Copy-Item -LiteralPath (Get-Command pwsh).Source -Destination $signedInput -Force

$saved = @{}
foreach ($name in $required + @("FAKE_SIGNING_ARGS_FILE", "FAKE_SIGNING_EXIT_CODE")) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  foreach ($name in $required) { [Environment]::SetEnvironmentVariable($name, "test-$name", "Process") }
  $env:FAKE_SIGNING_ARGS_FILE = $argsFile

  Remove-Item Env:AZURE_CLIENT_SECRET
  Assert-True ((Invoke-Signer $signedInput) -ne 0) "missing Azure configuration must fail"
  $env:AZURE_CLIENT_SECRET = "test-AZURE_CLIENT_SECRET"

  $env:FAKE_SIGNING_EXIT_CODE = "23"
  Assert-True ((Invoke-Signer $signedInput) -eq 23) "signer exit code must propagate"

  $env:FAKE_SIGNING_EXIT_CODE = "0"
  Assert-True ((Invoke-Signer $signedInput) -eq 0) "valid signed and timestamped output must pass"
  $arguments = Get-Content -Raw -LiteralPath $argsFile | ConvertFrom-Json
  Assert-True ($arguments[-1] -eq $signedInput) "a file path containing spaces must remain one argument"
  Assert-True ($arguments -contains "http://timestamp.acs.microsoft.com") "Microsoft RFC3161 timestamp server must be explicit"

  $unsignedInput = Join-Path $tempRoot "unsigned file.exe"
  [System.IO.File]::WriteAllBytes($unsignedInput, [byte[]](0..31))
  Assert-True ((Invoke-Signer $unsignedInput) -ne 0) "unsigned output must fail validation"

  $repoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
  $releaseWorkflow = Get-Content -Raw -LiteralPath (Join-Path $repoRoot ".github/workflows/desktop-release.yml")
  $testWorkflowPath = Join-Path $repoRoot ".github/workflows/windows-signing-test.yml"
  $toolInstallerPath = Join-Path $PSScriptRoot "install-windows-signing-tools.ps1"
  Assert-True (-not (Test-Path -LiteralPath $testWorkflowPath)) "branch signing tests must use the existing dispatchable release workflow"
  Assert-True (Test-Path -LiteralPath $toolInstallerPath) "the pinned signing-tool installer must exist"
  $toolInstaller = Get-Content -Raw -LiteralPath $toolInstallerPath
  $signingConfig = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "desktop/src-tauri/tauri.windows-signing.conf.json") | ConvertFrom-Json
  Assert-True ($signingConfig.bundle.windows.signCommand.cmd -eq "pwsh") "Tauri signing must use object command notation"
  Assert-True ($signingConfig.bundle.windows.signCommand.args[-1] -eq "%1") "Tauri must pass the signing path as one argument"
  $signScriptArgument = $signingConfig.bundle.windows.signCommand.args[2]
  Assert-True (Test-Path -LiteralPath (Join-Path $repoRoot "desktop/src-tauri/$signScriptArgument")) "the signing script must resolve from Tauri's bundle working directory"
  foreach ($workflow in @($releaseWorkflow)) {
    Assert-True ($workflow.Contains("install-windows-signing-tools.ps1")) "Windows jobs must share the pinned tool installer"
    foreach ($name in $required) {
      Assert-True ($workflow.Contains("secrets.$name")) "$name must come from Actions secrets"
    }
    Assert-True ($workflow.Contains("tauri.windows-signing.conf.json")) "Windows builds must opt into the signing config"
    Assert-True ($workflow.Contains("verify-windows-artifacts.ps1")) "built artifacts must be independently verified"
  }
  Assert-True (-not $toolInstaller.Contains("artifact-signing-cli")) "the signer must not use the CLI that exposes credentials in process arguments"
  Assert-True ($toolInstaller.Contains('Install-Module -Name ArtifactSigning -RequiredVersion "0.1.8"')) "Microsoft ArtifactSigning module must be pinned"
  Assert-True ($toolInstaller.Contains("Get-AuthenticodeSignature")) "the installed Microsoft module signature must be verified"
  Assert-True ($toolInstaller.Contains("verify -Signatures")) "downloaded NuGet signing dependencies must have valid package signatures"
  Assert-True ($toolInstaller.Contains("992D70CAC5B06C38EFEC91806CABA64CDCC07E6D963A0959DBBBAF264D33B800")) "NuGet CLI checksum must be pinned"
  foreach ($version in @("10.0.26100.4188", "1.0.128", "0.9.1-beta.26227.3")) {
    Assert-True ($toolInstaller.Contains($version)) "official signing dependency $version must be pinned"
  }
  $signerSource = Get-Content -Raw -LiteralPath $scriptPath
  Assert-True ($signerSource.Contains("Invoke-ArtifactSigning")) "the official Microsoft module must perform signing"
  Assert-True ($signerSource.Contains("ExcludeAzureCliCredential")) "signing must not fall back to Azure CLI credentials"
  Assert-True ($toolInstaller.Contains("minisign-0.12-win64.zip")) "official minisign 0.12 archive must be pinned"
  Assert-True ($toolInstaller.Contains("37b600344e20c19314b2e82813db2bfdcc408b77b876f7727889dbd46d539479")) "minisign archive SHA-256 must be pinned"
  Assert-True (-not $toolInstaller.Contains("cargo install minisign")) "the library-only minisign crate must not be installed as a CLI"
  $artifactVerifier = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "verify-windows-artifacts.ps1")
  Assert-True ($artifactVerifier.Contains('FromBase64String([System.IO.File]::ReadAllText($signatureFile).Trim())')) "Tauri base64 updater signatures must be decoded before minisign verification"
  Assert-True ($releaseWorkflow.Contains("windows-signing-test:")) "release workflow must expose a non-publishing branch test job"
  Assert-True ($releaseWorkflow.Contains("if: needs.preflight.outputs.proceed == 'true' && github.ref == 'refs/heads/main'")) "release-mutating builds must be main-only"
  Assert-True ($releaseWorkflow.Contains("inputs.platform == 'windows' || inputs.platform == 'all'")) "every non-main dispatch containing Windows must use the test job"
  Assert-True ($releaseWorkflow.Contains("if: matrix.platform != 'windows-latest'")) "tauri-action must never upload Windows before verification"
  Assert-True ($releaseWorkflow -match 'permissions:\r?\n\s+contents: read') "workflow permissions must default to read-only"
  Assert-True ($releaseWorkflow.Contains("actions/upload-artifact")) "branch test must retain verified artifacts"
  $standaloneSignCommand = './scripts/sign-windows.ps1 -FilePath (Resolve-Path ./src-tauri/target/release/scrollr-desktop.exe)'
  Assert-True (([regex]::Matches($releaseWorkflow, [regex]::Escape($standaloneSignCommand))).Count -eq 2) "release and branch builds must sign the standalone application after Tauri restores it"
  $windowsBuildIndex = $releaseWorkflow.IndexOf("- name: Build signed Windows artifacts")
  $windowsVerifyIndex = $releaseWorkflow.IndexOf("- name: Verify Windows Authenticode and updater signatures")
  $windowsStageIndex = $releaseWorkflow.IndexOf("- name: Stage verified Windows artifacts")
  $windowsPublishIndex = $releaseWorkflow.IndexOf("publish-windows:")
  Assert-True (0 -le $windowsBuildIndex -and $windowsBuildIndex -lt $windowsVerifyIndex -and $windowsVerifyIndex -lt $windowsStageIndex -and $windowsStageIndex -lt $windowsPublishIndex) "Windows must build, verify, stage, then publish in that order"
  Assert-True ($releaseWorkflow.Contains("Re-verify staged Windows bytes")) "staged release bytes must be verified again before GitHub Release upload"
  Assert-True ($releaseWorkflow.Contains('any(.assets[]; .name == "latest.json")')) "a missing updater manifest must be confirmed before initializing one"
  Assert-True ($releaseWorkflow.Contains("Failed to download the existing updater manifest.")) "existing updater manifest download failures must stop publishing"
  Assert-True ($releaseWorkflow -match '(?s)fix-appimage-signature:.*?permissions:\s+contents: write') "AppImage signature repair must retain release upload permission"

  Write-Host "Windows signing checks passed."
} finally {
  foreach ($name in $saved.Keys) {
    [Environment]::SetEnvironmentVariable($name, $saved[$name], "Process")
  }
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}

exit 0
