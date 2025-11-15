#Requires -Version 5.1
<#
.SYNOPSIS
    Generates a pgAdmin servers.json configuration file.

.DESCRIPTION
    Creates a servers.json file that can be imported into pgAdmin 4 to quickly
    set up a server connection. The file does not contain passwords for security.

.PARAMETER Name
    Display name for the server connection. Default: "Local PostgreSQL"

.PARAMETER Host
    PostgreSQL server hostname or IP address. Default: "127.0.0.1"

.PARAMETER Port
    PostgreSQL server port. Default: 5432

.PARAMETER Database
    Maintenance database name. Default: "postgres"

.PARAMETER SSLMode
    SSL connection mode. Default: "prefer"
    Valid values: disable, allow, prefer, require, verify-ca, verify-full

.PARAMETER OutputPath
    Full path where servers.json should be written.
    Default: Desktop\servers.json

.EXAMPLE
    .\New-ServersJson.ps1
    Creates servers.json on Desktop with default settings.

.EXAMPLE
    .\New-ServersJson.ps1 -Host "192.168.1.100" -Port 5433 -Name "Remote PostgreSQL"
    Creates servers.json with custom connection settings.

.EXAMPLE
    .\New-ServersJson.ps1 -OutputPath "C:\pgadmin\servers.json"
    Creates servers.json at a specific location.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$Name = "Local PostgreSQL",
    
    [Parameter(Mandatory=$false)]
    [string]$Host = "127.0.0.1",
    
    [Parameter(Mandatory=$false)]
    [ValidateRange(1, 65535)]
    [int]$Port = 5432,
    
    [Parameter(Mandatory=$false)]
    [string]$Database = "postgres",
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("disable", "allow", "prefer", "require", "verify-ca", "verify-full")]
    [string]$SSLMode = "prefer",
    
    [Parameter(Mandatory=$false)]
    [string]$OutputPath = "$([Environment]::GetFolderPath('Desktop'))\servers.json"
)

$ErrorActionPreference = "Stop"

Write-Host "`n📄 Generating pgAdmin servers.json..." -ForegroundColor Cyan
Write-Host "  Name: $Name" -ForegroundColor Gray
Write-Host "  Host: $Host" -ForegroundColor Gray
Write-Host "  Port: $Port" -ForegroundColor Gray
Write-Host "  Database: $Database" -ForegroundColor Gray
Write-Host "  SSL Mode: $SSLMode" -ForegroundColor Gray
Write-Host "  Output: $OutputPath" -ForegroundColor Gray

# Create servers.json structure
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
            Comment = "PostgreSQL server connection"
            PassFile = ""
            Color = "auto"
            Favorite = $false
            Shared = $false
            Background = $false
        }
    }
}

try {
    # Convert to JSON with proper formatting
    $jsonContent = $serversJson | ConvertTo-Json -Depth 10
    
    # Ensure output directory exists
    $outputDir = Split-Path $OutputPath -Parent
    if (-not (Test-Path $outputDir)) {
        New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
    }
    
    # Write file
    $jsonContent | Out-File -FilePath $OutputPath -Encoding UTF8 -Force
    
    Write-Host "`n✓ Successfully created servers.json" -ForegroundColor Green
    Write-Host "  Location: $OutputPath" -ForegroundColor Gray
    
    Write-Host "`n📋 To import in pgAdmin 4:" -ForegroundColor Cyan
    Write-Host "   1. Open pgAdmin 4" -ForegroundColor White
    Write-Host "   2. Go to File → Preferences → Browser → Servers" -ForegroundColor White
    Write-Host "   3. Or use: File → Import/Export Servers... → Import" -ForegroundColor White
    Write-Host "   4. Select: $OutputPath" -ForegroundColor White
    Write-Host "   5. Enter your PostgreSQL password when connecting" -ForegroundColor White
    Write-Host "`n⚠️  Note: Passwords are not stored in servers.json for security." -ForegroundColor Yellow
    
    exit 0
} catch {
    Write-Host "`n✗ Failed to create servers.json: $_" -ForegroundColor Red
    exit 1
}








