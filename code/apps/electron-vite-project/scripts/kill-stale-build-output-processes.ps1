# Stops processes that keep old C:\build-output\<oldBuild>\ trees locked (often empty win-unpacked).
# Pass the basename to KEEP (e.g. build010). All other directories under C:\build-output are targeted.
param(
  [Parameter(Mandatory = $true)]
  [string] $KeepBasename
)

$ErrorActionPreference = 'SilentlyContinue'
$base = 'C:\build-output'
if (-not (Test-Path -LiteralPath $base)) { exit 0 }

$staleDirs = @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $KeepBasename })
if ($staleDirs.Count -eq 0) { exit 0 }

foreach ($dir in $staleDirs) {
  $needle = $dir.FullName
  $needleLower = $needle.ToLowerInvariant()

  # LibreOffice --version probes set OOO_CWD to win-unpacked and keep the folder locked (empty tree).
  $staleBase = $dir.Name.ToLowerInvariant()
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $cmd = $_.CommandLine
    if (-not $cmd) { return }
    $cmdLower = $cmd.ToLowerInvariant()
    if ($cmdLower.Contains($needleLower) -or ($cmdLower.Contains('ooo_cwd=') -and $cmdLower.Contains("build-output") -and $cmdLower.Contains($staleBase))) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host "[kill-stale-build] Stopped PID $($_.ProcessId) $($_.Name) (cmdline cwd under stale output)"
    }
  }

  # Podman Desktop / WSL: wslhost.exe and win-sshproxy.exe often hold File handles on old win-unpacked.
  $handleExe = Join-Path $env:TEMP 'handle64.exe'
  if (-not (Test-Path -LiteralPath $handleExe)) {
    $handleExe = Join-Path $env:TEMP 'handle.exe'
  }
  if (Test-Path -LiteralPath $handleExe) {
    $handleOut = & $handleExe -accepteula $needle 2>&1 | Out-String
    foreach ($m in [regex]::Matches($handleOut, 'pid:\s*(\d+)')) {
      $hid = [int]$m.Groups[1].Value
      Stop-Process -Id $hid -Force -ErrorAction SilentlyContinue
      Write-Host "[kill-stale-build] Stopped PID $hid (handle on $needle)"
    }
  }

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
    $exe = $_.ExecutablePath
    $cmd = $_.CommandLine
    $match = $false
    if ($exe) {
      $e = $exe.ToLowerInvariant()
      if ($e.StartsWith($needleLower + '\') -or $e -eq $needleLower) { $match = $true }
    }
    if (-not $match -and $cmd) {
      if ($cmd.ToLowerInvariant().Contains($needleLower)) { $match = $true }
    }
    if ($match) {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Host "[kill-stale-build] Stopped PID $($_.ProcessId) $($_.Name)"
    }
  }
}

# Windows Search workers often keep directory handles on cache/indexed folders (no EXE under build-output).
Get-Process -Name 'SearchProtocolHost' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'SearchFilterHost' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name 'SearchHost' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Close Explorer windows browsed into a stale output tree (folder handle on win-unpacked).
try {
  $shell = New-Object -ComObject Shell.Application
  foreach ($w in @($shell.Windows())) {
    try {
      $p = $w.Document.Folder.Self.Path
      if (-not $p) { continue }
      foreach ($dir in $staleDirs) {
        $pref = $dir.FullName
        if ($p.StartsWith($pref, [System.StringComparison]::OrdinalIgnoreCase)) {
          Write-Host "[kill-stale-build] Closing Explorer at $p"
          $w.Quit()
          break
        }
      }
    } catch {}
  }
} catch {}

# Stop Windows Search when permitted — releases indexer locks on stale folders. Restart from kill-wr-desk.cjs after deletes.
$wsearch = Get-Service WSearch -ErrorAction SilentlyContinue
if ($wsearch -and $wsearch.Status -eq 'Running') {
  Stop-Service WSearch -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  if ((Get-Service WSearch -ErrorAction SilentlyContinue).Status -eq 'Stopped') {
    Write-Host '[kill-stale-build] Stopped WSearch service (will restart after cleanup)'
  }
}
