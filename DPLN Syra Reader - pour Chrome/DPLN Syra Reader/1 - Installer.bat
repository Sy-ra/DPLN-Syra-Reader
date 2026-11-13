@echo off
chcp 65001 >nul
title Installation de DPLN Syra Reader
cd /d "%~dp0"
set "DR_DIR=%~dp0"
set "DR_ELECTRON=33.4.11"
set "LOG=%~dp0installation-log.txt"
echo Installation DPLN Syra Reader - %date% %time% > "%LOG%"
echo Dossier : %~dp0>> "%LOG%"

echo.
echo  ==========================================
echo    Installation de DPLN Syra Reader
echo  ==========================================
echo.

if exist "runtime\electron.exe" (
  echo  Le moteur de l'app est deja installe.
  goto :shortcut
)

echo  Telechargement du moteur de l'app ^(Electron, environ 100 Mo^)...
echo  Ca peut prendre 1 a 3 minutes selon ta connexion.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; $ProgressPreference = 'SilentlyContinue';" ^
  "$v = $env:DR_ELECTRON; $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'ia32' };" ^
  "$url = \"https://github.com/electron/electron/releases/download/v$v/electron-v$v-win32-$arch.zip\"; Write-Output \"Electron $v ($arch) : $url\";" ^
  "$zip = Join-Path $env:TEMP \"dsr-electron-v$v-$arch.zip\";" ^
  "Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip;" ^
  "$rt = Join-Path $env:DR_DIR 'runtime'; if (Test-Path $rt) { Remove-Item $rt -Recurse -Force };" ^
  "Write-Output 'Extraction...'; Expand-Archive -Path $zip -DestinationPath $rt -Force; Remove-Item $zip -Force; Write-Output 'OK'" >> "%LOG%" 2>&1

if not exist "runtime\electron.exe" (
  echo.
  echo  [!] Le moteur de l'app n'a pas pu etre installe.
  echo      - Verifie ta connexion internet et relance ce fichier.
  echo      - Si ton antivirus a affiche une alerte, autorise "electron.exe"
  echo        ^(moteur officiel aussi utilise par Discord, VS Code...^).
  echo      - Sinon, envoie le fichier "installation-log.txt" de ce dossier.
  echo ECHEC : runtime\electron.exe absent >> "%LOG%"
  pause
  exit /b 1
)
echo runtime\electron.exe OK >> "%LOG%"

:shortcut
echo.
echo  Creation des raccourcis "DPLN Syra Reader"...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$d = $env:DR_DIR.TrimEnd('\'); $sh = New-Object -ComObject WScript.Shell;" ^
  "$targets = @(\"$d\DPLN Syra Reader.lnk\"); if (-not $env:DR_NO_SHORTCUT) { $targets += [Environment]::GetFolderPath('Desktop') + '\DPLN Syra Reader.lnk' };" ^
  "foreach ($t in $targets) { $s = $sh.CreateShortcut($t); $s.TargetPath = \"$d\runtime\electron.exe\"; $s.Arguments = '\"' + $d + '\"'; $s.WorkingDirectory = $d; $s.IconLocation = \"$d\build\icon.ico,0\"; $s.Description = 'DPLN Syra Reader'; $s.Save() }" >> "%LOG%" 2>&1

echo.
echo  ==========================================
echo    C'est installe !
echo  ==========================================
echo.
echo  - Lance l'app avec le raccourci "DPLN Syra Reader" (sur le Bureau
echo    et dans ce dossier).
echo  - N'oublie pas d'installer l'extension du navigateur : voir le tuto.
echo.
pause
