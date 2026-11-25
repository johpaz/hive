; Hooks del instalador NSIS de Hive Agents.
;
; El gateway (hive-gateway.exe) corre como sidecar y como proceso hijo suyo.
; La plantilla de Tauri solo comprueba si está abierto el ejecutable
; principal, así que un gateway vivo bloquea la sobrescritura y la
; desinstalación ("No se ha podido desinstalar"). Se cierra antes de tocar
; archivos, tanto al instalar/actualizar como al desinstalar.

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM hive-gateway.exe'
  Pop $0
  Sleep 800
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /T /IM hive-gateway.exe'
  Pop $0
  Sleep 800
!macroend
