@echo off
setlocal
echo Stopping Abrar Medical Store Server on port 3000...
powershell -NoProfile -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " ^
  "foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }"
echo Server stopped cleanly.
timeout /t 2 >nul
exit /b 0
