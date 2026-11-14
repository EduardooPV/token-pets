; Ao desinstalar, remove também o "iniciar com o Windows" que o próprio app registra.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dev.eduardoopv.tokenpets"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Token Pets"
!macroend
