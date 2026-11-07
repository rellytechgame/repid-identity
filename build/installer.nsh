; Windows Explorer context menu for RePID Identity (per-user install, so HKCU — no admin needed).
; Right-clicking a folder or a drive offers "Analizar con RePID Identity", which opens the Disk analyzer.

!macro customInstall
  ; Folder background and folders
  WriteRegStr HKCU "Software\Classes\Directory\shell\RePIDIdentity" "" "Analizar con RePID Identity"
  WriteRegStr HKCU "Software\Classes\Directory\shell\RePIDIdentity" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Directory\shell\RePIDIdentity\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--disk-scan=%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\RePIDIdentity" "" "Analizar con RePID Identity"
  WriteRegStr HKCU "Software\Classes\Drive\shell\RePIDIdentity" "Icon" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  WriteRegStr HKCU "Software\Classes\Drive\shell\RePIDIdentity\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--disk-scan=%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\RePIDIdentity"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\RePIDIdentity"
!macroend
