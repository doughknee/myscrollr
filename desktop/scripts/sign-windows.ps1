param(
  [Parameter(Mandatory = $true)][string]$FilePath,
  [string]$TestCommand
)

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  [Console]::Error.WriteLine("Windows signing can only run on Windows.")
  exit 1
}

$required = @(
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_CODE_SIGNING_ACCOUNT_NAME",
  "AZURE_CODE_SIGNING_CERT_PROFILE_NAME",
  "AZURE_CODE_SIGNING_ENDPOINT"
)

foreach ($name in $required) {
  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, "Process"))) {
    [Console]::Error.WriteLine("Missing required Windows signing secret: $name")
    exit 1
  }
}

if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
  [Console]::Error.WriteLine("Signing target does not exist.")
  exit 1
}

if ($TestCommand) {
  $null = & pwsh -NoProfile -File $TestCommand `
    -FileDigest SHA256 `
    -TimestampRfc3161 http://timestamp.acs.microsoft.com `
    -TimestampDigest SHA256 `
    -FilePath $FilePath 2>&1
  if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("Artifact Signing failed with exit code $LASTEXITCODE.")
    exit $LASTEXITCODE
  }
} else {
  Import-Module ArtifactSigning -RequiredVersion "0.1.8" -ErrorAction Stop
  try {
    $null = Invoke-ArtifactSigning `
      -Endpoint $env:AZURE_CODE_SIGNING_ENDPOINT `
      -CodeSigningAccountName $env:AZURE_CODE_SIGNING_ACCOUNT_NAME `
      -CertificateProfileName $env:AZURE_CODE_SIGNING_CERT_PROFILE_NAME `
      -Files $FilePath `
      -FileDigest SHA256 `
      -TimestampRfc3161 http://timestamp.acs.microsoft.com `
      -TimestampDigest SHA256 `
      -Description Scrollr `
      -ExcludeWorkloadIdentityCredential `
      -ExcludeManagedIdentityCredential `
      -ExcludeSharedTokenCacheCredential `
      -ExcludeVisualStudioCredential `
      -ExcludeVisualStudioCodeCredential `
      -ExcludeAzureCliCredential `
      -ExcludeAzurePowerShellCredential `
      -ExcludeAzureDeveloperCliCredential `
      -ExcludeInteractiveBrowserCredential
  } catch {
    [Console]::Error.WriteLine("Artifact Signing failed.")
    exit 1
  }
}

$signature = Get-AuthenticodeSignature -LiteralPath $FilePath
if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
  [Console]::Error.WriteLine("Authenticode validation failed with status $($signature.Status).")
  exit 1
}

if ($null -eq $signature.TimeStamperCertificate) {
  [Console]::Error.WriteLine("Authenticode signature is missing an RFC3161 timestamp.")
  exit 1
}

Write-Host "Authenticode verified: $(Split-Path -Leaf $FilePath) [$($signature.SignerCertificate.Subject)]"
exit 0
