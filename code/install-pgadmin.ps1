#Requires -Version 5.1
<#
.SYNOPSIS
    Installs pgAdmin 4 and optionally PostgreSQL on Windows using winget or Chocolatey.

.DESCRIPTION
    This script installs pgAdmin 4 (latest stable) using winget (preferred) or Chocolatey (fallback).
    Optionally installs PostgreSQL if -InstallPostgres is specified.
    Creates shortcuts and generates a servers.json file for easy connection setup.

.PARAMETER InstallPostgres
    Also install PostgreSQL (latest stable version).

.PARAMETER NoLaunch
    Do not launch pgAdmin after installation.

.PARAMETER ShowGeneratedPassword
    Display generated PostgreSQL password in output (if generated).

.EXAMPLE
    .\install-pgadmin.ps1
    Installs pgAdmin 4 only.

.EXAMPLE
    .\install-pgadmin.ps1 -InstallPostgres
    Installs both pgAdmin 4 and PostgreSQL.

.NOTES
    Requires administrator privileges.
    Idempotent - safe to re-run multiple times.
#>

param(
    [switch]$InstallPostgres,
    [switch]$NoLaunch,
    [switch]$ShowGeneratedPassword
)

$ErrorActionPreference = "Stop"
$script:ExitCode = 0

#region Admin Check
function Test-AdminElevation {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-AdminElevation)) {
    Write-Host "⚠️  This script requires administrator privileges. Elevating..." -ForegroundColor Yellow
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $($PSBoundParameters.GetEnumerator() | ForEach-Object { "-$($_.Key):$($_.Value)" })"
    exit 0
}
#endregion

#region Package Manager Detection
function Test-WingetAvailable {
    try {
        $null = Get-Command winget -ErrorAction Stop
        return $true
    } catch {
        return $false
    }
}

function Install-Chocolatey {
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "✓ Chocolatey is already installed" -ForegroundColor Green
        return $true
    }

    Write-Host "📦 Installing Chocolatey..." -ForegroundColor Cyan
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force -ErrorAction Stop
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
        $chocoInstallScript = Invoke-WebRequest -Uri "https://community.chocolatey.org/install.ps1" -UseBasicParsing
        Invoke-Expression $chocoInstallScript.Content
        
        # Refresh PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        
        if (Get-Command choco -ErrorAction SilentlyContinue) {
            Write-Host "✓ Chocolatey installed successfully" -ForegroundColor Green
            return $true
        } else {
            Write-Host "✗ Chocolatey installation may have failed" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "✗ Failed to install Chocolatey: $_" -ForegroundColor Red
        return $false
    }
}
#endregion

#region Package Installation
function Get-WingetPackageId {
    param([string]$SearchTerm, [string]$FilterPattern)
    
    Write-Host "🔍 Searching for $SearchTerm..." -ForegroundColor Cyan
    try {
        $searchOutput = winget search $SearchTerm --exact 2>&1 | Out-String
        $lines = $searchOutput -split "`n"
        
        foreach ($line in $lines) {
            if ($line -match $FilterPattern) {
                # Extract package ID (usually first column after headers)
                $parts = $line -split '\s+', 2
                if ($parts.Count -ge 2) {
                    $id = $parts[0].Trim()
                    if ($id -and $id -notmatch '^Name$' -and $id -notmatch '^---') {
                        Write-Host "  Found: $id" -ForegroundColor Gray
                        return $id
                    }
                }
            }
        }
        
        # Fallback: try to find official package
        $searchOutput = winget search $SearchTerm 2>&1 | Out-String
        if ($searchOutput -match "PostgreSQL\.pgAdmin4|pgAdmin4") {
            $match = [regex]::Match($searchOutput, "(\S+)\s+PostgreSQL\.pgAdmin4")
            if ($match.Success) {
                return $match.Groups[1].Value
            }
        }
        
        return $null
    } catch {
        Write-Host "  ⚠️  Search failed: $_" -ForegroundColor Yellow
        return $null
    }
}

function Install-PgAdminWinget {
    Write-Host "`n📦 Installing pgAdmin 4 via winget..." -ForegroundColor Cyan
    
    # Check if already installed
    $installed = winget list PostgreSQL.pgAdmin4 --exact 2>&1 | Out-String
    if ($installed -match "PostgreSQL\.pgAdmin4") {
        Write-Host "✓ pgAdmin 4 is already installed" -ForegroundColor Green
        
        # Try to get version
        $versionMatch = [regex]::Match($installed, "(\d+\.\d+\.\d+)")
        if ($versionMatch.Success) {
            Write-Host "  Version: $($versionMatch.Groups[1].Value)" -ForegroundColor Gray
        }
        return $true
    }
    
    # Find package ID
    $packageId = Get-WingetPackageId -SearchTerm "pgadmin" -FilterPattern "PostgreSQL\.pgAdmin4|pgAdmin4"
    
    if (-not $packageId) {
        Write-Host "⚠️  Could not find exact package ID, trying common IDs..." -ForegroundColor Yellow
        $packageId = "PostgreSQL.pgAdmin4"
    }
    
    Write-Host "  Installing package: $packageId" -ForegroundColor Gray
    
    try {
        $installOutput = winget install --exact --id $packageId --accept-package-agreements --accept-source-agreements -h 2>&1 | Out-String
        
        if ($LASTEXITCODE -eq 0 -or $installOutput -match "already installed|successfully installed") {
            Write-Host "✓ pgAdmin 4 installed successfully" -ForegroundColor Green
            return $true
        } else {
            Write-Host "✗ Installation may have failed. Exit code: $LASTEXITCODE" -ForegroundColor Red
            Write-Host "  Output: $installOutput" -ForegroundColor Gray
            return $false
        }
    } catch {
        Write-Host "✗ Installation failed: $_" -ForegroundColor Red
        return $false
    }
}

function Install-PgAdminChoco {
    Write-Host "`n📦 Installing pgAdmin 4 via Chocolatey..." -ForegroundColor Cyan
    
    # Check if already installed
    $installed = choco list pgadmin4 --local-only 2>&1 | Out-String
    if ($installed -match "pgadmin4") {
        Write-Host "✓ pgAdmin 4 is already installed" -ForegroundColor Green
        return $true
    }
    
    try {
        choco install pgadmin4 -y --no-progress 2>&1 | Out-Null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ pgAdmin 4 installed successfully" -ForegroundColor Green
            return $true
        } else {
            Write-Host "✗ Installation failed. Exit code: $LASTEXITCODE" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "✗ Installation failed: $_" -ForegroundColor Red
        return $false
    }
}

function Install-PostgreSQLWinget {
    Write-Host "`n📦 Installing PostgreSQL via winget..." -ForegroundColor Cyan
    
    # Check if already installed
    $installed = winget list PostgreSQL.PostgreSQL 2>&1 | Out-String
    if ($installed -match "PostgreSQL\.PostgreSQL") {
        Write-Host "✓ PostgreSQL is already installed" -ForegroundColor Green
        return $true
    }
    
    # Find package ID
    $packageId = Get-WingetPackageId -SearchTerm "postgresql" -FilterPattern "PostgreSQL\.PostgreSQL"
    
    if (-not $packageId) {
        $packageId = "PostgreSQL.PostgreSQL"
    }
    
    Write-Host "  Installing package: $packageId" -ForegroundColor Gray
    
    try {
        $installOutput = winget install --exact --id $packageId --accept-package-agreements --accept-source-agreements -h 2>&1 | Out-String
        
        if ($LASTEXITCODE -eq 0 -or $installOutput -match "already installed|successfully installed") {
            Write-Host "✓ PostgreSQL installed successfully" -ForegroundColor Green
            
            # Check if password was set (this is tricky - PostgreSQL installer may prompt)
            Write-Host "`n⚠️  Note: If PostgreSQL installer prompted for a password, use that password." -ForegroundColor Yellow
            Write-Host "   If no password was set, you may need to set one manually." -ForegroundColor Yellow
            
            return $true
        } else {
            Write-Host "✗ Installation may have failed. Exit code: $LASTEXITCODE" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "✗ Installation failed: $_" -ForegroundColor Red
        return $false
    }
}

function Install-PostgreSQLChoco {
    Write-Host "`n📦 Installing PostgreSQL via Chocolatey..." -ForegroundColor Cyan
    
    # Check if already installed
    $installed = choco list postgresql --local-only 2>&1 | Out-String
    if ($installed -match "postgresql") {
        Write-Host "✓ PostgreSQL is already installed" -ForegroundColor Green
        return $true
    }
    
    try {
        choco install postgresql -y --no-progress 2>&1 | Out-Null
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ PostgreSQL installed successfully" -ForegroundColor Green
            Write-Host "⚠️  Note: Default superuser password may be 'postgres' or empty." -ForegroundColor Yellow
            return $true
        } else {
            Write-Host "✗ Installation failed. Exit code: $LASTEXITCODE" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "✗ Installation failed: $_" -ForegroundColor Red
        return $false
    }
}
#endregion

#region Shortcut Creation
function New-DesktopShortcut {
    param(
        [string]$TargetPath,
        [string]$ShortcutName,
        [string]$Arguments = ""
    )
    
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $shortcutPath = Join-Path $desktopPath "$ShortcutName.lnk"
    
    if (Test-Path $shortcutPath) {
        Write-Host "✓ Desktop shortcut already exists: $ShortcutName" -ForegroundColor Green
        return
    }
    
    try {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $TargetPath
        $shortcut.Arguments = $Arguments
        $shortcut.WorkingDirectory = Split-Path $TargetPath -Parent
        $shortcut.Save()
        Write-Host "✓ Created desktop shortcut: $ShortcutName" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Could not create desktop shortcut: $_" -ForegroundColor Yellow
    }
}

function Find-PgAdminExecutable {
    $commonPaths = @(
        "${env:ProgramFiles}\pgAdmin 4\runtime\pgAdmin4.exe",
        "${env:ProgramFiles(x86)}\pgAdmin 4\runtime\pgAdmin4.exe",
        "${env:ProgramFiles}\pgAdmin 4\bin\pgAdmin4.exe",
        "${env:LocalAppData}\Programs\pgAdmin 4\pgAdmin4.exe"
    )
    
    foreach ($path in $commonPaths) {
        if (Test-Path $path) {
            return $path
        }
    }
    
    # Try registry
    try {
        $regPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
        $installed = Get-ItemProperty $regPath -ErrorAction SilentlyContinue | 
            Where-Object { $_.DisplayName -like "*pgAdmin*" }
        
        if ($installed) {
            $installLocation = $installed.InstallLocation
            if ($installLocation) {
                $exePath = Join-Path $installLocation "runtime\pgAdmin4.exe"
                if (Test-Path $exePath) {
                    return $exePath
                }
            }
        }
    } catch {
        # Ignore registry errors
    }
    
    return $null
}
#endregion

#region Servers.json Generation
function New-ServersJsonFile {
    param(
        [string]$OutputPath = "$([Environment]::GetFolderPath('Desktop'))\servers.json",
        [string]$Name = "Local PostgreSQL",
        [string]$Host = "127.0.0.1",
        [int]$Port = 5432,
        [string]$Database = "postgres",
        [string]$SSLMode = "prefer"
    )
    
    $serversJson = @{
        Servers = @{
            "1" = @{
                Name = $Name
                Group = "Servers"
                Port = $Port
                Host = $Host
                MaintenanceDB = $Database
                Username = ""
                SSLMode = $SSLMode
                Comment = "Local PostgreSQL instance"
                PassFile = ""
                Color = "auto"
            }
        }
    } | ConvertTo-Json -Depth 10
    
    try {
        $serversJson | Out-File -FilePath $OutputPath -Encoding UTF8 -Force
        Write-Host "✓ Created servers.json at: $OutputPath" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "✗ Failed to create servers.json: $_" -ForegroundColor Red
        return $false
    }
}
#endregion

#region Main Execution
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  pgAdmin 4 Installation Script" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Detect package manager
$useWinget = Test-WingetAvailable
if ($useWinget) {
    Write-Host "✓ Using winget as package manager" -ForegroundColor Green
} else {
    Write-Host "⚠️  winget not available, will use Chocolatey" -ForegroundColor Yellow
    if (-not (Install-Chocolatey)) {
        Write-Host "✗ Failed to set up Chocolatey. Cannot proceed." -ForegroundColor Red
        exit 1
    }
}

# Install pgAdmin 4
if ($useWinget) {
    $pgAdminInstalled = Install-PgAdminWinget
} else {
    $pgAdminInstalled = Install-PgAdminChoco
}

if (-not $pgAdminInstalled) {
    Write-Host "✗ Failed to install pgAdmin 4" -ForegroundColor Red
    $script:ExitCode = 1
}

# Install PostgreSQL if requested
if ($InstallPostgres) {
    if ($useWinget) {
        $postgresInstalled = Install-PostgreSQLWinget
    } else {
        $postgresInstalled = Install-PostgreSQLChoco
    }
    
    if (-not $postgresInstalled) {
        Write-Host "⚠️  PostgreSQL installation had issues" -ForegroundColor Yellow
    }
}

# Find pgAdmin executable and create shortcuts
$pgAdminExe = Find-PgAdminExecutable
if ($pgAdminExe) {
    Write-Host "`n✓ Found pgAdmin executable: $pgAdminExe" -ForegroundColor Green
    New-DesktopShortcut -TargetPath $pgAdminExe -ShortcutName "pgAdmin 4"
} else {
    Write-Host "`n⚠️  Could not locate pgAdmin executable. Shortcut creation skipped." -ForegroundColor Yellow
    Write-Host "   pgAdmin should be available from Start Menu." -ForegroundColor Gray
}

# Generate servers.json
Write-Host "`n📄 Generating servers.json..." -ForegroundColor Cyan
if (New-ServersJsonFile) {
    Write-Host "`n📋 To import servers.json in pgAdmin:" -ForegroundColor Cyan
    Write-Host "   1. Open pgAdmin 4" -ForegroundColor White
    Write-Host "   2. Go to File → Preferences → Browser → Servers" -ForegroundColor White
    Write-Host "   3. Or use: File → Import/Export Servers... → Import" -ForegroundColor White
    Write-Host "   4. Select the servers.json file from your Desktop" -ForegroundColor White
    Write-Host "   5. Enter your PostgreSQL password when connecting" -ForegroundColor White
}

# Post-install smoke test
if ($pgAdminExe -and -not $NoLaunch) {
    Write-Host "`n🚀 Launching pgAdmin 4..." -ForegroundColor Cyan
    try {
        Start-Process -FilePath $pgAdminExe -ErrorAction Stop
        Write-Host "✓ pgAdmin 4 launched successfully" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Could not launch pgAdmin: $_" -ForegroundColor Yellow
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

exit $script:ExitCode
#endregion









