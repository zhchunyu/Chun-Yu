@echo off
chcp 65001 >nul
title CampusTwin 本地预览（含安全管理模式）
cd /d "%~dp0"

echo.
echo ============================================================
echo   CampusTwin 本地预览 · 含安全管理模式
echo ============================================================
echo.

if not exist "node_modules\vite" (
  echo [x] 未找到 node_modules\vite
  echo     请先在本目录执行：  npm ci
  echo.
  pause
  exit /b 1
)

if not exist "src\features\safety\SafetyModePanel.jsx" (
  echo [!] 未找到安全管理模式文件，当前预览的可能是未整合版本。
  echo.
)

echo [1/2] 启动开发服务（Vite）...
echo       服务就绪后浏览器会自动打开
echo.

start "" cmd /c "timeout /t 6 >nul && start http://127.0.0.1:5173/?safety=1&scene=2d"

echo [2/2] 常用地址：
echo       安全模式 + 2D 风险叠加   http://127.0.0.1:5173/?safety=1^&scene=2d
echo       安全模式 + 3D 主视角     http://127.0.0.1:5173/?safety=1
echo       普通地图（默认不变）     http://127.0.0.1:5173/
echo.
echo       按 Ctrl+C 停止服务。
echo ------------------------------------------------------------
echo.

call npx vite --port 5173 --host 127.0.0.1
