# ============================================================================
# Write Boundary CI Guardrail (PowerShell / Windows)
# ============================================================================
#
# Same rules as check-write-boundary.sh — see that file for documentation.
#
# Run: powershell -ExecutionPolicy Bypass -File scripts/check-write-boundary.ps1
# CI:  npm run check:write-boundary:win
# ============================================================================

$ErrorActionPreference = "Continue"
$autofillDir = "apps/extension-chromium/src/vault/autofill"
$exitCode = 0

Write-Host "=== Write Boundary Check ===" -ForegroundColor Cyan
Write-Host ""

# ── Helper: recursive grep ──
function Find-InFiles {
    param([string]$Path, [string]$Pattern, [string[]]$Include = @("*.ts","*.tsx"))
    $results = @()
    foreach ($glob in $Include) {
        $files = Get-ChildItem -Path $Path -Filter $glob -Recurse -File -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $matches = Select-String -Path $f.FullName -Pattern $Pattern -ErrorAction SilentlyContinue
            foreach ($m in $matches) {
                $rel = $m.Path.Replace((Get-Location).Path + "\", "").Replace("\", "/")
                $results += "${rel}:$($m.LineNumber):$($m.Line.Trim())"
            }
        }
    }
    return $results
}

# ── Rule 1: setValueSafely imports ──
Write-Host "[Rule 1] setValueSafely imports restricted to committer.ts, inlinePopover.ts, *.test.ts"

$all = Find-InFiles -Path $autofillDir -Pattern "import.*setValueSafely"
$violations = $all |
    Where-Object { $_ -notmatch "committer\.ts:" } |
    Where-Object { $_ -notmatch "inlinePopover\.ts:" } |
    Where-Object { $_ -notmatch "\.test\.ts:" } |
    Where-Object { $_ -notmatch "writeBoundary\.ts:" } |
    Where-Object { $_ -notmatch "//.*setValueSafely" }

if ($violations) {
    Write-Host "  FAIL: Forbidden import of setValueSafely:" -ForegroundColor Red
    $violations | ForEach-Object { Write-Host "    $_" }
    $exitCode = 1
} else {
    Write-Host "  PASS" -ForegroundColor Green
}

# ── Rule 2: barrel export ──
Write-Host "[Rule 2] setValueSafely must not appear in barrel export (index.ts)"

$indexFile = "$autofillDir/index.ts"
$barrelViolations = @()
if (Test-Path $indexFile) {
    $barrelViolations = Select-String -Path $indexFile -Pattern "export.*setValueSafely" -ErrorAction SilentlyContinue |
        Where-Object { $_.Line -notmatch "^\s*//" }
}

if ($barrelViolations) {
    Write-Host "  FAIL: setValueSafely exported from barrel:" -ForegroundColor Red
    $barrelViolations | ForEach-Object { Write-Host "    $($_.Line.Trim())" }
    $exitCode = 1
} else {
    Write-Host "  PASS" -ForegroundColor Green
}

# ── Rule 3: external imports ──
Write-Host "[Rule 3] setValueSafely must not be imported outside vault/autofill/"

$extAll = Find-InFiles -Path "apps/extension-chromium/src" -Pattern "import.*setValueSafely"
$extViolations = $extAll | Where-Object { $_ -notmatch "vault/autofill/" }

if ($extViolations) {
    Write-Host "  FAIL: External import of setValueSafely:" -ForegroundColor Red
    $extViolations | ForEach-Object { Write-Host "    $_" }
    $exitCode = 1
} else {
    Write-Host "  PASS" -ForegroundColor Green
}

# ── Rule 4: commitInsert calls ──
Write-Host "[Rule 4] commitInsert() calls restricted"

$commitAll = Find-InFiles -Path $autofillDir -Pattern "commitInsert\("
$commitCalls = $commitAll |
    Where-Object { $_ -notmatch "\.test\.ts:" } |
    Where-Object { $_ -notmatch "\.spec\.ts:" } |
    Where-Object { $_ -notmatch "committer\.ts:" } |
    Where-Object { $_ -notmatch "writeBoundary\.ts:" } |
    Where-Object { $_ -notmatch "//.*commitInsert" } |
    Where-Object { $_ -notmatch "export.*commitInsert" } |
    Where-Object { $_ -notmatch "'commitInsert'" } |
    Where-Object { $_ -notmatch "`"commitInsert`"" }

if ($commitCalls) {
    Write-Host "  WARN: commitInsert() called in production code:" -ForegroundColor Yellow
    $commitCalls | ForEach-Object { Write-Host "    $_" }
} else {
    Write-Host "  PASS" -ForegroundColor Green
}

Write-Host ""
if ($exitCode -ne 0) {
    Write-Host "RESULT: FAIL" -ForegroundColor Red
} else {
    Write-Host "RESULT: PASS" -ForegroundColor Green
}

exit $exitCode
