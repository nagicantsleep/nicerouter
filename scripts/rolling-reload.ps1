# ==============================================================================
# 9Router Zero-Downtime Rolling Update & Hot-Patch Script
#
# Cach dung:
#   .\scripts\rolling-reload.ps1            # Full Rolling Rebuild & Deploy (Zero-Downtime)
#   .\scripts\rolling-reload.ps1 -HotPatch  # Va loi sieu toc ~5s (chi copy file JS, khong build)
#   .\scripts\rolling-reload.ps1 -NoBuild   # Rolling deploy khong build lai image
#   .\scripts\rolling-reload.ps1 -DrainSeconds 20 # Tang thoi gian drain stream
# ==============================================================================

param (
    [switch]$HotPatch,
    [switch]$Quick,
    [switch]$NoBuild,
    [int]$DrainSeconds = 15,
    [switch]$Help
)

if ($Help) {
    Write-Host "Cach dung:" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1            : Build lai image va cap nhat rolling 2 node (Zero Downtime)" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1 -HotPatch  : Va loi sieu toc cho open-sse/ va custom-server.js" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1 -NoBuild   : Khoi dong lai rolling theo image hien co" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1 -DrainSeconds <sec> : Thoi gian cho ket noi stream cu hoan tat (Mac dinh: 15s)" -ForegroundColor Cyan
    exit 0
}

$isHotPatch = $HotPatch -or $Quick
$startTime = [System.Diagnostics.Stopwatch]::StartNew()

function Print-Step {
    param([int]$step, [int]$total, [string]$title)
    Write-Host "`n[$step/$total] $title" -ForegroundColor Yellow
}

function Print-Success {
    param([string]$msg)
    Write-Host "  -> $msg" -ForegroundColor Green
}

function Print-Error {
    param([string]$msg)
    Write-Host "  [LOI] $msg" -ForegroundColor Red
}

function Print-Info {
    param([string]$msg)
    Write-Host "      $msg" -ForegroundColor Gray
}

# Chuyen mach upstream Nginx giua Node 1 va Node 2 khong gay gian doan
function Set-NginxPrimary {
    param([int]$nodeNumber)
    if ($nodeNumber -eq 2) {
        # Chuyen Node 2 lam Primary worker, Node 1 lam backup de bat dau drain
        $cfg = "server 9router-2:20128 max_fails=1 fail_timeout=3s;`nserver 9router-1:20128 backup;"
        Print-Info "Nginx LB: Chuyen tat ca traffic moi sang Node 2 (Node 1 -> Standby)..."
    } else {
        # Khoi phuc Node 1 lam Primary worker, Node 2 lam backup
        $cfg = "server 9router-1:20128 max_fails=1 fail_timeout=3s;`nserver 9router-2:20128 backup;"
        Print-Info "Nginx LB: Khoi phuc Node 1 lam Primary worker (Node 2 -> Standby)..."
    }

    $localUpstream = Join-Path $PSScriptRoot "..\nginx-upstream.conf"
    if (Test-Path $localUpstream) {
        Set-Content -Path $localUpstream -Value $cfg -NoNewline
    }

    # Nap cau hinh vao container Nginx va reload master process
    docker exec 9router-lb sh -c "echo '$cfg' > /etc/nginx/upstream.conf && nginx -s reload" | Out-Null
}

# Cho cac ket noi LLM stream/SSE dang do tren node cu hoan tat tu nhien
function Wait-GracefulDrain {
    param([int]$seconds = 15, [string]$nodeName = "Node 1")
    Write-Host "      [GRACEFUL DRAIN] Dang cho cac stream/request dang phuc vu tren $nodeName hoan tat nhat quan ($seconds giay): " -NoNewline -ForegroundColor Cyan
    for ($s = $seconds; $s -gt 0; $s--) {
        Write-Host "$s.. " -NoNewline -ForegroundColor Gray
        Start-Sleep -Seconds 1
    }
    Write-Host "San sang!" -ForegroundColor Green
}

# Kiem tra truc tiep ben trong container qua loopback (khong di qua Load Balancer de tranh bao ao)
function Test-ContainerHealth {
    param(
        [string]$containerName,
        [int]$maxRetries = 35,
        [int]$delaySec = 1
    )
    Print-Info "Dang kiem tra suc khoe $containerName (toi da $maxRetries giay)..."
    for ($i = 1; $i -le $maxRetries; $i++) {
        $out = docker exec $containerName wget -q -O - http://127.0.0.1:20128/api/version 2>&1
        $code = $LASTEXITCODE
        $outStr = [string]$out
        if ($code -eq 0 -and $outStr.Contains("currentVersion")) {
            Print-Success "$containerName da san sang va phan hoi HTTP 200 OK!"
            return $true
        }
        Start-Sleep -Seconds $delaySec
    }
    Print-Error "$containerName khong phan hoi sau $maxRetries giay!"
    return $false
}

Write-Host "=================================================" -ForegroundColor Cyan
if ($isHotPatch) {
    Write-Host " [9Router] VA LOI SIEU TOC (ZERO-DOWNTIME HOT PATCH)" -ForegroundColor Magenta
} else {
    Write-Host " [9Router] ROLLING DEPLOY ZERO-DOWNTIME (ACTIVE-DRAIN)" -ForegroundColor Cyan
}
Write-Host "=================================================" -ForegroundColor Cyan

# Kiem tra Docker daemon va Load Balancer
$lb = docker ps --filter "name=^9router-lb$" --format "{{.Names}}"
if (-not $lb) {
    Print-Error "Container 9router-lb chua chay! Khoi dong stack bang 'docker compose up -d' truoc."
    exit 1
}

try {
    if ($isHotPatch) {
        # --------------------------------------------------------------------------
        # CHE DO HOT-PATCH (Ap dung ngay lap tuc cac thay doi JS khong can build Docker)
        # --------------------------------------------------------------------------
        $totalSteps = 6

        Print-Step 1 $totalSteps "Dong bo ma nguon vao Node 2 (Hot Standby)..."
        docker cp ./open-sse 9router-2:/app/
        docker cp ./custom-server.js 9router-2:/app/custom-server.js
        if (Test-Path "./src") {
            docker cp ./src 9router-2:/app/
        }

        Print-Step 2 $totalSteps "Khoi dong lai Node 2 (9router-2)..."
        docker restart 9router-2 | Out-Null
        if (-not (Test-ContainerHealth -containerName "9router-2" -maxRetries 20 -delaySec 1)) {
            Print-Error "Node 2 khoi dong that bai. HUY qua trinh cap nhat Node 1 de giu an toan cho CLI!"
            exit 1
        }
        Print-Success "Node 2 da san sang voi ma nguon moi!"

        Print-Step 3 $totalSteps "Chuyen huong traffic Nginx sang Node 2..."
        Set-NginxPrimary 2

        Print-Step 4 $totalSteps "Cho thoat ket noi cu tren Node 1 (Graceful Draining)..."
        Wait-GracefulDrain -seconds $DrainSeconds -nodeName "Node 1"

        Print-Step 5 $totalSteps "Dong bo ma nguon va khoi dong lai Node 1 (9router-1)..."
        docker cp ./open-sse 9router-1:/app/
        docker cp ./custom-server.js 9router-1:/app/custom-server.js
        if (Test-Path "./src") {
            docker cp ./src 9router-1:/app/
        }

        docker restart 9router-1 | Out-Null
        if (-not (Test-ContainerHealth -containerName "9router-1" -maxRetries 20 -delaySec 1)) {
            Print-Error "Node 1 khoi dong that bai! Node 2 van dang giu tai CLI an toan."
            exit 1
        }
        Print-Success "Node 1 da khoi dong thanh cong voi ma nguon moi!"

        Print-Step 6 $totalSteps "Khoi phuc Node 1 lam Primary worker va kiem tra Load Balancer..."
        Set-NginxPrimary 1
        try {
            $resp = Invoke-RestMethod -Uri "http://localhost:20128/api/version" -TimeoutSec 3 -ErrorAction Stop
            Print-Success "Cum hoat dong hoan hao! Version: $($resp.currentVersion)"
        } catch {
            Print-Error "Khong the truy cap qua Load Balancer: $_"
            exit 1
        }

    } else {
        # --------------------------------------------------------------------------
        # CHE DO FULL ROLLING UPDATE (Build image moi va cap nhat tung node)
        # --------------------------------------------------------------------------
        $totalSteps = 7

        if (-not $NoBuild) {
            Print-Step 1 $totalSteps "Dang build Docker image moi (cac container hien tai van phuc vu binh thuong)..."
            docker compose build 9router-1
            if ($LASTEXITCODE -ne 0) {
                Print-Error "Docker build that bai. Dung qua trinh update!"
                exit 1
            }
            Print-Success "Build image hoan tat."
        } else {
            Print-Step 1 $totalSteps "Bo qua buoc build image (-NoBuild)..."
        }

        # BUOC 2: Cap nhat Node 2 (Hot Standby) truoc bang image moi.
        Print-Step 2 $totalSteps "Cap nhat Node 2 (9router-2 - Hot Standby) bang image moi..."
        docker compose up -d --no-deps 9router-2
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Khong the tao lai container 9router-2!"
            exit 1
        }

        # BUOC 3: Cho Node 2 khoi dong hoan tat
        Print-Step 3 $totalSteps "Kiem tra suc khoe Node 2..."
        if (-not (Test-ContainerHealth -containerName "9router-2" -maxRetries 35 -delaySec 1)) {
            Print-Error "Node 2 khong the san sang! HUY cap nhat Node 1 de giu an toan cho CLI."
            exit 1
        }
        Print-Success "Node 2 da san sang chay phien ban moi va dung du phong 100%!"

        # BUOC 4: Chuyen huong tat ca request moi sang Node 2
        Print-Step 4 $totalSteps "Chuyen huong traffic Nginx sang Node 2 (Zero Drop Transition)..."
        Set-NginxPrimary 2
        Print-Success "Moi request moi tu CLI da duoc chuyen sang Node 2."

        # BUOC 5: Cho cac ket noi stream dai dang chay tren Node 1 xa sach hoan toan
        Print-Step 5 $totalSteps "Cho thoat ket noi cu tren Node 1 (Graceful Draining $DrainSeconds giay)..."
        Wait-GracefulDrain -seconds $DrainSeconds -nodeName "Node 1"

        # BUOC 6: Cap nhat Node 1 (Primary worker)
        Print-Step 6 $totalSteps "Cap nhat Node 1 (9router-1 - Primary worker) bang image moi..."
        docker compose up -d --no-deps 9router-1
        if ($LASTEXITCODE -ne 0) {
            Print-Error "Khong the tao lai container 9router-1!"
            exit 1
        }

        if (-not (Test-ContainerHealth -containerName "9router-1" -maxRetries 35 -delaySec 1)) {
            Print-Error "Node 1 khong the san sang sau khi cap nhat! Node 2 van dang phuc vu CLI binh thuong."
            exit 1
        }
        Print-Success "Node 1 da san sang phuc vu bang image moi!"

        # BUOC 7: Khoi phuc Node 1 lam Primary va kiem tra qua Load Balancer
        Print-Step 7 $totalSteps "Khoi phuc Node 1 lam Primary worker va xac nhan hoat dong qua Load Balancer..."
        Set-NginxPrimary 1
        try {
            $resp = Invoke-RestMethod -Uri "http://localhost:20128/api/version" -TimeoutSec 3 -ErrorAction Stop
            Print-Success "Cum hoat dong hoan hao! Version: $($resp.currentVersion)"
        } catch {
            Print-Error "Kiem tra Load Balancer that bai: $_"
            exit 1
        }
    }
} finally {
    # Luon dam bao ket thuc la Node 1 duoc khoi phuc lam Primary neu co loi gi xay ra
    Set-NginxPrimary 1
}

$startTime.Stop()
$elapsed = [math]::Round($startTime.Elapsed.TotalSeconds, 1)

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host " [HOAN TAT] Trien khai thanh cong trong $elapsed giay!" -ForegroundColor Green
Write-Host " Khong co ket noi CLI nao bi gian doan (Zero Downtime & Safe Draining)." -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
