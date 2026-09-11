param(
  [string]$FileDigest,
  [string]$TimestampRfc3161,
  [string]$TimestampDigest,
  [string]$FilePath
)

if ($env:FAKE_SIGNING_ARGS_FILE) {
  @($FileDigest, $TimestampRfc3161, $TimestampDigest, $FilePath) |
    ConvertTo-Json |
    Set-Content -LiteralPath $env:FAKE_SIGNING_ARGS_FILE
}

exit ([int]($env:FAKE_SIGNING_EXIT_CODE ?? "0"))
