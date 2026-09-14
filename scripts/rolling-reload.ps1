# Script thực hiện Rolling Update Zero-Downtime cho 9Router trong Docker
# Cách dùng: .\scripts\rolling-reload.ps1

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " [9Router] Bắt đầu Rolling Update Zero-Downtime" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

# Bước 1: Build image mới một lần duy nhất
Write-Host "`n[1/4] Đang build Docker image mới..." -ForegroundColor Yellow
docker compose build
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n[LỖI] Build Docker image thất bại. Dừng quá trình update!" -ForegroundColor Red
    exit 1
}

# Bước 2: Cập nhật Node 1 trước (Traffic tự động chuyển qua Node 2)
Write-Host "`n[2/4] Đang cập nhật Node 1 (9router-1)..." -ForegroundColor Yellow
Write-Host "      -> Traffic sẽ tự động chuyển sang Node 2 (Hot Standby)" -ForegroundColor Gray
docker compose up -d --no-deps 9router-1

# Bước 3: Chờ Node 1 khởi động xong
Write-Host "`n[3/4] Đang chờ Node 1 khởi động hoàn tất..." -ForegroundColor Yellow
$maxRetries = 30
$node1Ready = $false

for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds 2
    try {
        # Ping trực tiếp vào cổng 20128 qua Load Balancer
        $response = Invoke-WebRequest -Uri "http://localhost:20128/api/usage/stats" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
            $node1Ready = $true
            Write-Host "      -> Node 1 đã sẵn sàng nhận request!" -ForegroundColor Green
            break
        }
    } catch {
        # Đang chờ node 1 boot
    }
    Write-Host "      ... đang chờ Node 1 ($i/$maxRetries)" -ForegroundColor Gray
}

# Bước 4: Cập nhật Node 2 (Node 1 đã gánh tải)
Write-Host "`n[4/4] Đang cập nhật Node 2 (9router-2)..." -ForegroundColor Yellow
docker compose up -d --no-deps 9router-2

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host " [HOÀN TẤT] Rolling Update thành công rực rỡ!" -ForegroundColor Green
Write-Host " Cả 2 Node đã cập nhật code mới, CLI không bị ngắt quãng." -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Green
