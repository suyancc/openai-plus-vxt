$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$serviceRoot = Join-Path $root 'tools\outlook-otp-service'
$outputRoot = Join-Path $root '.output\outlook-otp-service'
$releaseRoot = $outputRoot
$distRoot = Join-Path $outputRoot 'dist'
$buildRoot = Join-Path $outputRoot 'build'
$specRoot = $outputRoot
$staticRoot = Join-Path $serviceRoot 'static'
$exePath = Join-Path $distRoot 'outlook-otp-service.exe'
$zipPath = Join-Path $outputRoot 'outlook-otp-service.zip'
$finalExePath = Join-Path $outputRoot 'outlook-otp-service.exe'

Get-ChildItem -Path $outputRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^\d{8}-\d{6}$' } |
  ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force
  }

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
$staticData = "$staticRoot;static"

Push-Location $serviceRoot
try {
  python -m PyInstaller `
    --clean `
    --onefile `
    --name outlook-otp-service `
    --distpath $distRoot `
    --workpath $buildRoot `
    --specpath $specRoot `
    --collect-submodules uvicorn `
    --collect-submodules fastapi `
    --collect-submodules pydantic `
    --collect-submodules starlette `
    --add-data $staticData `
    server.py
  if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed with exit code $LASTEXITCODE"
  }
}
finally {
  Pop-Location
}

Copy-Item -LiteralPath (Join-Path $serviceRoot 'README.md') -Destination (Join-Path $distRoot 'README.md') -Force

Compress-Archive -Path (Join-Path $distRoot '*') -DestinationPath $zipPath -Force
Copy-Item -LiteralPath $exePath -Destination $finalExePath -Force

Write-Host "Built: $exePath"
Write-Host "Zip:   $zipPath"
Write-Host "Release exe: $finalExePath"
