@echo off
chcp 65001 >nul
title 群友杀 - 一键联机
cd /d %~dp0

echo ============================================
echo   群友杀 · 公网联机启动
echo ============================================
echo.
echo [1/2] 启动游戏服务器 (localhost:8123) ...
start "群友杀服务器" cmd /k "node server.js 8123"

echo [2/2] 启动公网隧道 ...
echo.
echo   >>> 稍后弹出的"公网隧道"窗口里，找到一行
echo   >>> https://xxxx-xxxx-xxxx.trycloudflare.com
echo   >>> 把它发到群里，群友浏览器打开点「联机」即可
echo   >>> （每次重开隧道网址会变；本机游玩用 http://localhost:8123）
echo.
start "公网隧道" cmd /k "tools\cloudflared.exe tunnel --url http://localhost:8123"

timeout /t 3 >nul
echo 两个窗口都已启动。想停服：直接关闭那两个窗口即可。
pause
