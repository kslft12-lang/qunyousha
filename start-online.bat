@echo off
chcp 65001 >nul
title 群友杀 - 一键联机
cd /d %~dp0

echo ============================================
echo   群友杀 · 公网联机启动
echo ============================================
echo.
echo [1/3] 启动游戏服务器 (localhost:8123) ...
start "群友杀服务器" cmd /k "node server.js 8123"

echo [2/3] 启动公网隧道 ...
del tunnel.log 2>nul
start /min "公网隧道" cmd /k "tools\cloudflared.exe tunnel --protocol http2 --url http://localhost:8123 > tunnel.log 2>&1"

echo [3/3] 获取本次公网网址（约需 10~20 秒）...
powershell -NoProfile -Command ^
  "$u=$null; for($i=0; $i -lt 45 -and -not $u; $i++){" ^
  "  if(Test-Path tunnel.log){" ^
  "    $m = Select-String -Path tunnel.log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1;" ^
  "    if($m){ $u = $m.Matches[0].Value }" ^
  "  }" ^
  "  Start-Sleep 2" ^
  "}" ^
  "if($u){" ^
  "  Set-Clipboard -Value $u;" ^
  "  Add-Content -Path 当前网址.txt -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '] ' + $u);" ^
  "  Write-Host '';" ^
  "  Write-Host '============================================' -ForegroundColor Yellow;" ^
  "  Write-Host ('  本次公网网址（已复制到剪贴板）: ' + $u) -ForegroundColor Yellow;" ^
  "  Write-Host '  已追加保存到 当前网址.txt，直接粘贴发给群友即可' -ForegroundColor Yellow;" ^
  "  Write-Host '============================================' -ForegroundColor Yellow" ^
  "} else {" ^
  "  Write-Host '未能获取网址，请打开 tunnel.log 查看，或检查代理/网络' -ForegroundColor Red" ^
  "}"

echo.
echo 服务器窗口保持开着即可联机；本机游玩用 http://localhost:8123
echo 想停止：关闭"群友杀服务器"和"公网隧道"两个窗口（后者在任务栏最小化处）。
pause
