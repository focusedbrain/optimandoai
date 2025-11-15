# Script to check SQLite database contents
# This will show what data is stored in the orchestrator database

$dbPath = "$env:USERPROFILE\.opengiraffe\electron-data\orchestrator.db"

Write-Host "=== Checking SQLite Database ===" -ForegroundColor Cyan
Write-Host "Database path: $dbPath" -ForegroundColor White

if (Test-Path $dbPath) {
    Write-Host "✅ Database file exists!" -ForegroundColor Green
    
    # Get file info
    $fileInfo = Get-Item $dbPath
    Write-Host "Size: $($fileInfo.Length) bytes" -ForegroundColor White
    Write-Host "Last modified: $($fileInfo.LastWriteTime)" -ForegroundColor White
    
    # Check if sqlite3 is available
    $sqliteCmd = Get-Command sqlite3 -ErrorAction SilentlyContinue
    
    if ($sqliteCmd) {
        Write-Host "`n=== Querying database (requires password '123') ===" -ForegroundColor Yellow
        
        # Try to query the database
        # Note: This won't work because the database is encrypted
        # We need to use the Electron app's API to access it
        Write-Host "⚠️ Database is encrypted with SQLCipher - cannot query directly" -ForegroundColor Yellow
        Write-Host "Use the Electron app's HTTP API to query the data" -ForegroundColor White
    } else {
        Write-Host "`n⚠️ sqlite3 command not found - skipping database query" -ForegroundColor Yellow
    }
    
} else {
    Write-Host "❌ Database file not found!" -ForegroundColor Red
    Write-Host "The database should be created when you save a session" -ForegroundColor Yellow
}

Write-Host "`n=== Checking for related files ===" -ForegroundColor Cyan
$dbDir = "$env:USERPROFILE\.opengiraffe\electron-data"
if (Test-Path $dbDir) {
    Write-Host "Contents of $dbDir`:" -ForegroundColor White
    Get-ChildItem $dbDir | Format-Table Name, Length, LastWriteTime
} else {
    Write-Host "Directory not found: $dbDir" -ForegroundColor Red
}





