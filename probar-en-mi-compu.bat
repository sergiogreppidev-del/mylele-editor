@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo    MyLele Editor - Probar en esta compu
echo ============================================
echo.
if not exist "node_modules" (
  echo --- Primera vez: instalando ---
  call npm install
  echo.
)
if not exist ".env" (
  echo    FALTA EL ARCHIVO .env
  echo    Copia .env.example como .env y completa la clave.
  echo.
  pause
  exit /b 1
)
echo --- Levantando el editor (se abre solo en el navegador) ---
echo     Para cerrarlo: Ctrl+C en esta ventana.
echo.
call npm run dev
pause
