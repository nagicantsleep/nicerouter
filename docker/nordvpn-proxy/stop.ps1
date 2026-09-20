# Stop NordVPN Proxy Pool
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Stopping NordVPN Proxy Pool..." -ForegroundColor Yellow
docker compose down
Write-Host "NordVPN Proxy Pool stopped." -ForegroundColor Green
