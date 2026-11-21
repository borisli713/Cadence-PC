; Cadence Windows NSIS Installer Lifecycle Hooks
; Handles seamless upgrades: closes running instances, removes prior NSIS/MSI installs cleanly,
; preserves all user data (%LOCALAPPDATA%\com.cadence.shifts & %APPDATA%\com.cadence.shifts),
; and registers the cadence:// deep-link protocol.

!macro __CADENCE_UNINSTALL_OLD_MSI ROOT TAG
  StrCpy $R5 0
  __cadence_msi_loop_${TAG}:
    EnumRegKey $R6 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall" $R5
    StrCmp $R6 "" __cadence_msi_done_${TAG}
    ReadRegStr $R7 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R6" "DisplayName"
    StrCmp $R7 "Cadence" 0 __cadence_msi_next_${TAG}
    ReadRegStr $R8 ${ROOT} "Software\Microsoft\Windows\CurrentVersion\Uninstall\$R6" "WindowsInstaller"
    StrCmp $R8 "1" 0 __cadence_msi_next_${TAG}
      DetailPrint "Removing previous Cadence Windows Installer (MSI) while keeping user data..."
      ExecWait 'msiexec.exe /x $R6 /qn /norestart'
      Sleep 300
      Goto __cadence_msi_loop_${TAG}
  __cadence_msi_next_${TAG}:
    IntOp $R5 $R5 + 1
    Goto __cadence_msi_loop_${TAG}
  __cadence_msi_done_${TAG}:
!macroend

!macro __CADENCE_UNINSTALL_OLD_NSIS ROOT SUBKEY TAG
  ReadRegStr $R0 ${ROOT} "${SUBKEY}" "UninstallString"
  StrCmp $R0 "" __cadence_skip_${TAG}

  ; Strip optional leading and trailing quotes around UninstallString
  StrCpy $R1 $R0 1
  StrCmp $R1 '"' 0 __cadence_chk_tail_${TAG}
    StrCpy $R0 $R0 "" 1
  __cadence_chk_tail_${TAG}:
  StrCpy $R1 $R0 1 -1
  StrCmp $R1 '"' 0 __cadence_chk_file_${TAG}
    StrCpy $R0 $R0 -1
  __cadence_chk_file_${TAG}:

  IfFileExists "$R0" 0 __cadence_skip_${TAG}

  ; Derive parent directory of old uninstall.exe for _?= synchronous wait
  StrLen $R3 $R0
  StrCpy $R2 ""
  __cadence_dir_loop_${TAG}:
    IntOp $R3 $R3 - 1
    IntCmp $R3 0 __cadence_dir_done_${TAG} __cadence_dir_done_${TAG}
    StrCpy $R4 $R0 1 $R3
    StrCmp $R4 "\" 0 __cadence_dir_loop_${TAG}
    StrCpy $R2 $R0 $R3
  __cadence_dir_done_${TAG}:

  DetailPrint "Removing previous Cadence installation while keeping user data..."
  StrCmp $R2 "" __cadence_exec_no_dir_${TAG}
    ExecWait '"$R0" /S _?=$R2'
    Goto __cadence_after_exec_${TAG}
  __cadence_exec_no_dir_${TAG}:
    ExecWait '"$R0" /S'
  __cadence_after_exec_${TAG}:

  Delete "$R0"
  Sleep 350

  __cadence_skip_${TAG}:
!macroend

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Closing any running Cadence desktop instance..."
  nsExec::Exec 'taskkill /F /IM "cadence.exe"'
  Sleep 450

  ; Remove any prior MSI installation silently (keeps %APPDATA% / %LOCALAPPDATA% user data intact)
  !insertmacro __CADENCE_UNINSTALL_OLD_MSI HKCU "hkcu_msi"
  !insertmacro __CADENCE_UNINSTALL_OLD_MSI HKLM "hklm_msi"

  ; Remove any leftover prior NSIS installation silently while preserving user data
  !insertmacro __CADENCE_UNINSTALL_OLD_NSIS HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cadence" "hkcu_prod"
  !insertmacro __CADENCE_UNINSTALL_OLD_NSIS HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.cadence.shifts" "hkcu_id"
  !insertmacro __CADENCE_UNINSTALL_OLD_NSIS HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cadence" "hklm_prod"
  !insertmacro __CADENCE_UNINSTALL_OLD_NSIS HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.cadence.shifts" "hklm_id"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Ensure cadence:// custom URI protocol points directly to the newly installed binary
  WriteRegStr HKCU "Software\Classes\cadence" "" "URL:Cadence Desktop Protocol"
  WriteRegStr HKCU "Software\Classes\cadence" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\cadence\DefaultIcon" "" '"$INSTDIR\cadence.exe",0'
  WriteRegStr HKCU "Software\Classes\cadence\shell\open\command" "" '"$INSTDIR\cadence.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM "cadence.exe"'
  Sleep 350
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\cadence"
!macroend
