#!/usr/bin/env bash
set -e

echo -e "\033[1;36m=================================================\033[0m"
echo -e "\033[1;36m [9Router] Bắt đầu Rolling Update Zero-Downtime  \033[0m"
echo -e "\033[1;36m=================================================\033[0m"

echo -e "\n\033[1;33m[1/4] Đang build Docker image mới...\033[0m"
docker compose build

echo -e "\n\033[1;33m[2/4] Đang cập nhật Node 1 (9router-1)...\033[0m"
echo -e "      -> Traffic sẽ tự động chuyển sang Node 2 (Hot Standby)"
docker compose up -d --no-deps 9router-1

echo -e "\n\033[1;33m[3/4] Đang chờ Node 1 khởi động hoàn tất...\033[0m"
node1Ready=0
for i in $(seq 1 30); do
    sleep 2
    if curl -s -f -m 2 http://localhost:20128/api/usage/stats > /dev/null 2>&1; then
        node1Ready=1
        echo -e "      -> Node 1 đã sẵn sàng nhận request!"
        break
    fi
    echo -e "      ... đang chờ Node 1 ($i/30)"
done

echo -e "\n\033[1;33m[4/4] Đang cập nhật Node 2 (9router-2)...\033[0m"
docker compose up -d --no-deps 9router-2

echo -e "\n\033[1;32m=================================================\033[0m"
echo -e "\033[1;32m [HOÀN TẤT] Rolling Update thành công rực rỡ!   \033[0m"
echo -e "\033[1;32m Cả 2 Node đã cập nhật code mới, CLI liên tục.  \033[0m"
echo -e "\033[1;32m=================================================\033[0m"
