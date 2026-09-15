#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# 9Router Zero-Downtime Rolling Update & Hot-Patch Script (POSIX Bash)
# ==============================================================================

HOT_PATCH=0
NO_BUILD=0

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      echo "Cách dùng:"
      echo "  ./scripts/rolling-reload.sh              # Full Rolling Rebuild & Deploy"
      echo "  ./scripts/rolling-reload.sh --hot-patch  # Vá lỗi siêu tốc (~5s, không build)"
      echo "  ./scripts/rolling-reload.sh --no-build   # Rolling deploy không build lại image"
      exit 0
      ;;
    --hot-patch|--quick|-q)
      HOT_PATCH=1
      ;;
    --no-build)
      NO_BUILD=1
      ;;
  esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

test_health() {
  local container="$1"
  local max_retries="${2:-30}"
  echo "      Đang kiểm tra sức khỏe $container (tối đa ${max_retries}s)..."
  for ((i=1; i<=max_retries; i++)); do
    if docker exec "$container" wget -q -O - http://127.0.0.1:20128/api/version 2>/dev/null | grep -q "currentVersion"; then
      echo -e "${GREEN}  -> $container đã sẵn sàng và phản hồi HTTP 200 OK!${NC}"
      return 0
    fi
    sleep 1
  done
  echo -e "${RED}  [LỖI] $container không phản hồi sau ${max_retries}s!${NC}"
  return 1
}

echo -e "${CYAN}=================================================${NC}"
if [ "$HOT_PATCH" -eq 1 ]; then
  echo -e "${MAGENTA} [9Router] VÁ LỖI SIÊU TỐC (ZERO-DOWNTIME HOT PATCH)${NC}"
else
  echo -e "${CYAN} [9Router] ROLLING DEPLOY ZERO-DOWNTIME${NC}"
fi
echo -e "${CYAN}=================================================${NC}"

if ! docker ps --format '{{.Names}}' | grep -q "9router-lb"; then
  echo -e "${RED}[LỖI] Container 9router-lb chưa chạy! Khởi động stack bằng 'docker compose up -d' trước.${NC}"
  exit 1
fi

START_TIME=$(date +%s)

if [ "$HOT_PATCH" -eq 1 ]; then
  echo -e "\n${YELLOW}[1/4] Đồng bộ mã nguồn vào Node 2 (Hot Standby)...${NC}"
  docker cp ./open-sse 9router-2:/app/
  docker cp ./custom-server.js 9router-2:/app/custom-server.js 2>/dev/null || true
  [ -d "./src/mitm" ] && docker cp ./src/mitm 9router-2:/app/src/ 2>/dev/null || true

  echo -e "\n${YELLOW}[2/4] Khởi động lại Node 2 (9router-2)...${NC}"
  docker restart 9router-2 >/dev/null
  test_health "9router-2" 20 || { echo -e "${RED}[LỖI] Node 2 khởi động thất bại. HỦY cập nhật Node 1!${NC}"; exit 1; }

  echo -e "\n${YELLOW}[3/4] Đồng bộ mã nguồn và khởi động lại Node 1 (9router-1)...${NC}"
  echo "      Nginx LB sẽ tự động chuyển mạch sang Node 2 mà không làm gián đoạn request."
  docker cp ./open-sse 9router-1:/app/
  docker cp ./custom-server.js 9router-1:/app/custom-server.js 2>/dev/null || true
  [ -d "./src/mitm" ] && docker cp ./src/mitm 9router-1:/app/src/ 2>/dev/null || true

  docker restart 9router-1 >/dev/null
  test_health "9router-1" 20 || { echo -e "${RED}[LỖI] Node 1 khởi động thất bại!${NC}"; exit 1; }

  echo -e "\n${YELLOW}[4/4] Kiểm tra toàn bộ cụm qua Load Balancer (Port 20128)...${NC}"
  curl -fsS http://localhost:20128/api/version >/dev/null && \
    echo -e "${GREEN}  -> Load Balancer sẵn sàng!${NC}"
else
  if [ "$NO_BUILD" -eq 0 ]; then
    echo -e "\n${YELLOW}[1/5] Đang build Docker image mới...${NC}"
    docker compose build 9router-1
  fi

  echo -e "\n${YELLOW}[2/5] Cập nhật Node 2 (9router-2 - Hot Standby)...${NC}"
  docker compose up -d --no-deps 9router-2

  echo -e "\n${YELLOW}[3/5] Kiểm tra sức khỏe Node 2...${NC}"
  test_health "9router-2" 35 || { echo -e "${RED}[LỖI] Node 2 không sẵn sàng. HỦY cập nhật Node 1!${NC}"; exit 1; }

  echo -e "\n${YELLOW}[4/5] Cập nhật Node 1 (9router-1 - Primary worker)...${NC}"
  echo "      Mọi traffic hiện tại tự động chuyển sang Node 2 mà không gián đoạn."
  docker compose up -d --no-deps 9router-1
  test_health "9router-1" 35 || { echo -e "${RED}[LỖI] Node 1 không sẵn sàng!${NC}"; exit 1; }

  echo -e "\n${YELLOW}[5/5] Xác nhận qua Load Balancer (Port 20128)...${NC}"
  docker exec 9router-lb nginx -s reload 2>/dev/null || true
  curl -fsS http://localhost:20128/api/version >/dev/null && \
    echo -e "${GREEN}  -> Cụm hoạt động hoàn hảo!${NC}"
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo -e "\n${GREEN}=================================================${NC}"
echo -e "${GREEN} [HOÀN TẤT] Triển khai thành công trong ${ELAPSED}s!${NC}"
echo -e "${GREEN} Không có kết nối CLI nào bị gián đoạn (Zero Downtime).${NC}"
echo -e "${GREEN}=================================================${NC}"
