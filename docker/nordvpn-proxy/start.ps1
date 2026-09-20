# Start NordVPN Japan Proxy Pool (10 Distinct Japan Nodes)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host "Starting NordVPN Japan Proxy Pool (10 Nodes with Different IPs)..." -ForegroundColor Cyan
docker compose up -d

Write-Host "`nWaiting 5 seconds for WireGuard tunnels to establish..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

Write-Host "`nNordVPN Japan Proxy Pool is UP (10 Nodes)!" -ForegroundColor Green
Write-Host "  - JP 1  (jp866):   HTTP http://127.0.0.1:38201 | Shadowsocks 38301" -ForegroundColor White
Write-Host "  - JP 2  (jp883):   HTTP http://127.0.0.1:38202 | Shadowsocks 38302" -ForegroundColor White
Write-Host "  - JP 3  (jp846):   HTTP http://127.0.0.1:38203 | Shadowsocks 38303" -ForegroundColor White
Write-Host "  - JP 4  (jp1297):  HTTP http://127.0.0.1:38204 | Shadowsocks 38304" -ForegroundColor White
Write-Host "  - JP 5  (jp1294):  HTTP http://127.0.0.1:38205 | Shadowsocks 38305" -ForegroundColor White
Write-Host "  - JP 6  (jp1284):  HTTP http://127.0.0.1:38206 | Shadowsocks 38306" -ForegroundColor White
Write-Host "  - JP 7  (jp1303):  HTTP http://127.0.0.1:38207 | Shadowsocks 38307" -ForegroundColor White
Write-Host "  - JP 8  (jp1259):  HTTP http://127.0.0.1:38208 | Shadowsocks 38308" -ForegroundColor White
Write-Host "  - JP 9  (jp855):   HTTP http://127.0.0.1:38209 | Shadowsocks 38309" -ForegroundColor White
Write-Host "  - JP 10 (jp1181):  HTTP http://127.0.0.1:38210 | Shadowsocks 38310" -ForegroundColor White
Write-Host "`nRun .\test.ps1 to verify IPs and latency of all 10 nodes." -ForegroundColor Gray
