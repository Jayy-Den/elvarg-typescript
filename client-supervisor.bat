@echo off
REM Self-healing supervisor for the xRSPS web client dev server.
REM Restarts the client whenever it exits; logs every cycle.
cd /d C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\client
REM --trace-exit prints a stack trace to stderr at any process.exit() call site,
REM so the next mystery code-1 exit leaves the caller in this log.
set NODE_OPTIONS=--trace-exit
set LOG=C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\logs\client-supervisor.log
:loop
echo [%date% %time%] starting client dev server >> "%LOG%"
node C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\scripts\run-with-env.mjs development C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\client\node_modules\@craco\craco\dist\bin\craco.js start >> "%LOG%" 2>&1
echo [%date% %time%] client exited with code %errorlevel%, restarting in 3s >> "%LOG%"
REM 'timeout' exits immediately when stdin is redirected (fast-spin risk!);
REM ping-wait works regardless of stdin/console state.
ping -n 4 127.0.0.1 >nul
goto loop
