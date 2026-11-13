<#
Instala o Token Pets para o usuário atual (sem admin): copia a pasta empacotada para
%LOCALAPPDATA%\Programs\Token Pets e cria um atalho no Menu Iniciar.
Na primeira execução o próprio app se registra para iniciar com o Windows (menu da bandeja desliga).

Uso (depois de `pnpm dist`):  pwsh scripts/install.ps1 [-Source release/win-unpacked]
Para desinstalar: pwsh scripts/install.ps1 -Uninstall
#>
param(
  [string]$Source = (Join-Path $PSScriptRoot '..\release\win-unpacked'),
  [switch]$Uninstall
)

$target = Join-Path $env:LOCALAPPDATA 'Programs\Token Pets'
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Token Pets.lnk'

Get-Process -Name 'Token Pets' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

if ($Uninstall) {
  # desliga o início automático registrado pelo app
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'dev.eduardoopv.tokenpets' -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Token Pets' -ErrorAction SilentlyContinue
  if (Test-Path $target) { Remove-Item $target -Recurse -Force }
  if (Test-Path $lnk) { Remove-Item $lnk -Force }
  'Token Pets removido. (Os dados em %APPDATA%\token-pets ficam; apague a pasta se quiser.)'
  exit 0
}

$src = (Resolve-Path $Source).Path
if (-not (Test-Path (Join-Path $src 'Token Pets.exe'))) { Write-Error "Token Pets.exe não encontrado em $src. Rode 'pnpm dist' antes."; exit 1 }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $target -Recurse -Force

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $target 'Token Pets.exe'
$s.WorkingDirectory = $target
$s.Save()
"Instalado em $target"
Start-Process (Join-Path $target 'Token Pets.exe')
'Token Pets iniciado (veja o ícone na bandeja).'
