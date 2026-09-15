# ==============================================================================
# 9Router Instant Hot-Patch (Vá lỗi siêu tốc ~5s không ngắt CLI)
# ==============================================================================
$scriptPath = Join-Path $PSScriptRoot "rolling-reload.ps1"
& $scriptPath -HotPatch
