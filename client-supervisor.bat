@echo off
REM Self-healing supervisor for the xRSPS web client dev server.
REM Restarts the client whenever it exits; logs every cycle.
cd /d C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\client
set LOG=C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\logs\client-supervisor.log
:loop
echo [%date% %time%] starting client dev server >> "%LOG%"
node C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\scripts\run-with-env.mjs development C:\Users\Jayde\Documents\Elvarg-typescript\elvarg-typescript\client\node_modules\@craco\craco\dist\bin\craco.js start >> "%LOG%" 2>&1
echo [%date% %time%] client exited with code %errorlevel%, restarting in 3s >> "%LOG%"
timeout /t 3 /nobreak >nul
goto loop
