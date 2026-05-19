$ErrorActionPreference = "Stop"

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$root = Split-Path -Parent $PSScriptRoot
$profile = Join-Path $root ".chrome-debug"
$extension = Join-Path $root ".output\chrome-mv3"

if (-not (Test-Path $chrome)) {
  throw "Chrome not found: $chrome"
}

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$profile",
  "--load-extension=$extension",
  "https://chatgpt.com/auth/login"
)
