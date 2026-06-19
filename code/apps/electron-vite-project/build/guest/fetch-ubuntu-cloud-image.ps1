# Downloads the Ubuntu cloud image from the official manifest URL and verifies SHA256.
# Never bundles the image in the installer or repo.

param(
  [string]$ManifestPath,
  [string]$CacheDir
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $ManifestPath) { $ManifestPath = Join-Path $here 'ubuntu-cloud-image.manifest.json' }
if (-not $CacheDir) { $CacheDir = Join-Path $env:USERPROFILE '.opengiraffe\guest-cache' }

if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Manifest not found: $ManifestPath"
}

$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$url = [string]$manifest.url
$expectedSha = ([string]$manifest.sha256).ToLowerInvariant()
$filename = [string]$manifest.filename

if (-not $url.StartsWith('https://cloud-images.ubuntu.com/')) {
  throw "Refusing non-official Ubuntu image URL: $url"
}

New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
$dest = Join-Path $CacheDir $filename
$tmp = "$dest.download"

if (Test-Path -LiteralPath $dest) {
  $existing = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($existing -eq $expectedSha) {
  Write-Host "Image already cached with matching checksum: $dest"
    @{ path = $dest; sha256 = $existing; cached = $true } | ConvertTo-Json -Compress
    exit 0
  }
  Write-Host 'Cached image checksum mismatch; re-downloading.'
  Remove-Item -LiteralPath $dest -Force
}

Write-Host "Downloading from official source: $url"
Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $dest -Force

$actual = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $expectedSha) {
  Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue
  throw "Checksum verification failed. Expected $expectedSha got $actual"
}

Write-Host "Checksum verified: $actual"
@{ path = $dest; sha256 = $actual; cached = $false } | ConvertTo-Json -Compress
