@echo off
echo ==============================================
echo Khởi động Server Quản Lý Khách Hàng AI...
echo ==============================================
echo.

set DEV_URL=http://localhost:3000

REM Mở trình duyệt web
start "" "%DEV_URL%"

REM Chạy server node.js
node server/server.js

pause
