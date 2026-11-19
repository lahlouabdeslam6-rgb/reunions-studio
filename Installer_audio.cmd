@echo off
setlocal
cd /d "%~dp0"
if not defined REUNIONS_PYTHON set "REUNIONS_PYTHON=python"
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" if "%REUNIONS_PYTHON%"=="python" set "REUNIONS_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
"%REUNIONS_PYTHON%" -m pip install --disable-pip-version-check --upgrade --target .runtime faster-whisper==1.2.1 av==16.1.0 pypdf==6.21.4
if errorlevel 1 goto end
set "HF_HUB_DISABLE_XET=1"
"%REUNIONS_PYTHON%" local_tools.py setup
if errorlevel 1 goto end
echo Le moteur de transcription est pret. Lancez Lancer_Studio.cmd.
:end
pause
