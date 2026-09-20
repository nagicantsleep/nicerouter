# Test NordVPN Japan Proxy Pool Endpoints (10 Nodes)
$proxies = @(
    @{ Name = "JP Node 1 (jp866)";   Port = 38201; Expected = "JP" },
    @{ Name = "JP Node 2 (jp883)";   Port = 38202; Expected = "JP" },
    @{ Name = "JP Node 3 (jp846)";   Port = 38203; Expected = "JP" },
    @{ Name = "JP Node 4 (jp1297)";  Port = 38204; Expected = "JP" },
    @{ Name = "JP Node 5 (jp1294)";  Port = 38205; Expected = "JP" },
    @{ Name = "JP Node 6 (jp1284)";  Port = 38206; Expected = "JP" },
    @{ Name = "JP Node 7 (jp1303)";  Port = 38207; Expected = "JP" },
    @{ Name = "JP Node 8 (jp1259)";  Port = 38208; Expected = "JP" },
    @{ Name = "JP Node 9 (jp855)";   Port = 38209; Expected = "JP" },
    @{ Name = "JP Node 10 (jp1181)"; Port = 38210; Expected = "JP" }
)

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Testing NordVPN Japan Proxy Pool (10 Nodes)    " -ForegroundColor Cyan
Write-Host "================================================`n" -ForegroundColor Cyan

$uniqueIps = @{}

foreach ($p in $proxies) {
    $proxyUrl = "http://127.0.0.1:$($p.Port)"
    Write-Host -NoNewline "Testing $($p.Name) ($proxyUrl)... "
    try {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $res = Invoke-RestMethod -Uri "https://ipinfo.io/json" -Proxy $proxyUrl -TimeoutSec 10 -ErrorAction Stop
        $sw.Stop()
        $uniqueIps[$res.ip] = $true
        Write-Host "ONLINE" -ForegroundColor Green
        Write-Host "   IP:      $($res.ip)" -ForegroundColor White
        Write-Host "   Country: $($res.country) ($($res.city))" -ForegroundColor White
        Write-Host "   Latency: $($sw.ElapsedMilliseconds) ms`n" -ForegroundColor Yellow
    } catch {
        Write-Host "FAILED ($($_.Exception.Message))`n" -ForegroundColor Red
    }
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " Total Unique IPs: $($uniqueIps.Count) / $($proxies.Count)" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan
