# Reset Corrupted Vault
# This script deletes the vault database and metadata file so you can create a new vault

Write-Host "`n=== VAULT RESET SCRIPT ===" -ForegroundColor Cyan
Write-Host "This will delete your vault database and metadata file.`n" -ForegroundColor Yellow

$vaultDb = "$env:USERPROFILE\.opengiraffe\electron-data\vault.db"
$vaultMeta = "$env:USERPROFILE\.opengiraffe\electron-data\vault.meta.json"

$confirm = Read-Host "Are you sure you want to delete the vault? Type 'yes' to confirm"

if ($confirm -eq 'yes') {
    if (Test-Path $vaultDb) {
        Remove-Item $vaultDb -Force
        Write-Host "✓ Deleted vault.db" -ForegroundColor Green
    } else {
        Write-Host "✗ vault.db not found" -ForegroundColor Yellow
    }
    
    if (Test-Path $vaultMeta) {
        Remove-Item $vaultMeta -Force
        Write-Host "✓ Deleted vault.meta.json" -ForegroundColor Green
    } else {
        Write-Host "✗ vault.meta.json not found" -ForegroundColor Yellow
    }
    
    Write-Host "`n✓ Vault reset complete! You can now create a new vault." -ForegroundColor Green
} else {
    Write-Host "`n✗ Reset cancelled." -ForegroundColor Red
}

