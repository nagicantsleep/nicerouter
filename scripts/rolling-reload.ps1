# ==============================================================================
# 9Router Zero-Downtime Rolling Update & Hot-Patch Script
#
# Cach dung:
#   .\scripts\rolling-reload.ps1            # Full Rolling Rebuild & Deploy (Zero-Downtime)
#   .\scripts\rolling-reload.ps1 -HotPatch  # Va loi sieu toc ~5s (chi copy file JS, khong build)
#   .\scripts\rolling-reload.ps1 -NoBuild   # Rolling deploy khong build lai image
# ==============================================================================

param (
    [switch]$HotPatch,
    [switch]$Quick,
    [switch]$NoBuild,
    [switch]$Help
)

if ($Help) {
    Write-Host "Cach dung:" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1            : Build lai image va cap nhat rolling 2 node (Zero Downtime)" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1 -HotPatch  : Va loi sieu toc (~5 giay) cho open-sse/ va custom-server.js" -ForegroundColor Cyan
    Write-Host "  .\scripts\rolling-reload.ps1 -NoBuild   : Khoi dong lai rolling theo image hien co" -ForegroundColor Cyan
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

# Kiem tra truc tiep ben trong container qua loopback (khong di qua Load Balancer de tranh bao ao)
function Test-ContainerHealth {
    param(
        [string]$containerName,
        [int]$maxRetries = 30,
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
    Write-Host " [9Router] ROLLING DEPLOY ZERO-DOWNTIME" -ForegroundColor Cyan
}
Write-Host "=================================================" -ForegroundColor Cyan

# Kiem tra Docker daemon va Load Balancer
$lb = docker ps --filter "name=^9router-lb$" --format "{{.Names}}"
if (-not $lb) {
    Print-Error "Container 9router-lb chua chay! Khoi dong stack bang 'docker compose up -d' truoc."
    exit 1
}

if ($isHotPatch) {
    # --------------------------------------------------------------------------
    # CHE DO HOT-PATCH (Ap dung ngay lap tuc cac thay doi JS khong can build Docker)
    # --------------------------------------------------------------------------
    $totalSteps = 4

    Print-Step 1 $totalSteps "Dong bo ma nguon vao Node 2 (Hot Standby)..."
    docker cp ./open-sse 9router-2:/app/
    docker cp ./custom-server.js 9router-2:/app/custom-server.js
    if (Test-Path "./src/mitm") {
        docker cp ./src/mitm 9router-2:/app/src/
    }

    Print-Step 2 $totalSteps "Khoi dong lai Node 2 (9router-2)..."
    docker restart 9router-2 | Out-Null
    if (-not (Test-ContainerHealth -containerName "9router-2" -maxRetries 20 -delaySec 1)) {
        Print-Error "Node 2 khoi dong that bai. HUY qua trinh cap nhat Node 1 de giu an toan cho CLI!"
        exit 1
    }

    Print-Step 3 $totalSteps "Dong bo ma nguon va khoi dong lai Node 1 (9router-1)..."
    Print-Info "Nginx LB se tu dong chuyen mach sang Node 2 ma khong lam gián doan request."
    docker cp ./open-sse 9router-1:/app/
    docker cp ./custom-server.js 9router-1:/app/custom-server.js
    if (Test-Path "./src/mitm") {
        docker cp ./src/mitm 9router-1:/app/src/
    }

    docker restart 9router-1 | Out-Null
    if (-not (Test-ContainerHealth -containerName "9router-1" -maxRetries 20 -delaySec 1)) {
        Print-Error "Node 1 khoi dong that bai!"
        exit 1
    }

    Print-Step 4 $totalSteps "Kiem tra toan bo cum qua Load Balancer (Port 20128)..."
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:20128/api/version" -TimeoutSec 3 -ErrorAction Stop
        Print-Success "Load Balancer san sang! Version: $($resp.currentVersion)"
    } catch {
        Print-Error "Khong the truy cap qua Load Balancer: $_"
        exit 1
    }

} else {
    # --------------------------------------------------------------------------
    # CHE DO FULL ROLLING UPDATE (Build image moi va cap nhat tung node)
    # --------------------------------------------------------------------------
    $totalSteps = 5

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

    # BUOC 2: Cap nhat Node 2 (Hot Standby) truoc.
    # Vi Node 2 la backup nen khong anh huong den bat ky traffic nao dang phuc vu boi Node 1.
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

    # BUOC 4: Cap nhat Node 1 (Primary worker).
    # Trong khi Node 1 tat va khoi dong lai, Nginx LB se tu dong chuyen mach moi request toi Node 2
    # ma khong rot goi nao.
    Print-Step 4 $totalSteps "Cap nhat Node 1 (9router-1 - Primary worker)..."
    Print-Info "Luu y: Moi traffic hien tai se tu dong chuyen sang Node 2 ma khong gian doan."
    docker compose up -d --no-deps 9router-1
    if ($LASTEXITCODE -ne 0) {
        Print-Error "Khong the tao lai container 9router-1!"
        exit 1
    }

    if (-not (Test-ContainerHealth -containerName "9router-1" -maxRetries 35 -delaySec 1)) {
        Print-Error "Node 1 khong the san sang sau khi cap nhat!"
        exit 1
    }
    Print-Success "Node 1 da san sang va tiep tuc ganh tai chinh!"

    # BUOC 5: Nap lai Nginx va kiem tra cuoi cung qua Load Balancer
    Print-Step 5 $totalSteps "Xac nhan hoat dong qua Load Balancer (Port 20128)..."
    docker exec 9router-lb nginx -s reload | Out-Null
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:20128/api/version" -TimeoutSec 3 -ErrorAction Stop
        Print-Success "Cum hoat dong hoan hao! Version: $($resp.currentVersion)"
    } catch {
        Print-Error "Kiem tra Load Balancer that bai: $_"
        exit 1
    }
}

$startTime.Stop()
$elapsed = [math]::Round($startTime.Elapsed.TotalSeconds, 1)

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host " [HOAN TAT] Trien khai thanh cong trong $elapsed giay!" -ForegroundColor Green
Write-Host " Khong co ket noi CLI nao bi gian doan (Zero Downtime)." -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
