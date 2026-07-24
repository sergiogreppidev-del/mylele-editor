@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo    MyLele Editor - Subir cambios a GitHub
echo ============================================
echo.
set /p msg="Mensaje del commit (Enter = usar fecha y hora): "
if "%msg%"=="" set "msg=Update %date% %time%"
echo.
echo --- Guardando cambios ---
git add -A
git commit -m "%msg%"
echo.
echo --- Trayendo cambios del remoto (por si hay) ---
git pull origin main --no-rebase --no-edit
echo.
echo --- Subiendo a GitHub ---
git push origin main
echo.
echo ============================================
echo    Listo. Vercel compila y redeploya solo
echo    en menos de un minuto.
echo.
echo    Si arriba dice "CONFLICT", avisale a Claude
echo    con lo que muestra la pantalla.
echo ============================================
echo.
pause
