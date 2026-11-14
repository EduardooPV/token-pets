; Atualizações do NSIS podem preservar a ausência de atalhos antigos. O app deve continuar acessível no Iniciar.
!macro customInstall
  !insertmacro createMenuDirectory
  CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
  WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
!macroend

; Ao desinstalar, remove também o "iniciar com o Windows" que o próprio app registra.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dev.eduardoopv.tokenpets"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Token Pets"
!macroend
