!macro NSIS_HOOK_PREINSTALL
  ; Force terminate all related processes and drivers before unpacking/updating files.
  nsExec::Exec `taskkill /IM horizon-gateway.exe /F /T`
  nsExec::Exec `taskkill /IM horizon-gateway-serve.exe /F /T`
  nsExec::Exec `taskkill /IM hgc.exe /F /T`
  nsExec::Exec `net stop WinDivert`
  nsExec::Exec `sc stop WinDivert`
  Sleep 500
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; WinDivert user-mode DLL + driver must live next to the exe (Windows loader / WinDivertOpen).
  IfFileExists "$INSTDIR\WinDivert.dll" skip_wd_dll
  IfFileExists "$INSTDIR\resources\WinDivert.dll" 0 skip_wd_dll
    CopyFiles /SILENT "$INSTDIR\resources\WinDivert.dll" "$INSTDIR\WinDivert.dll"
  skip_wd_dll:

  IfFileExists "$INSTDIR\WinDivert64.sys" skip_wd_sys
  IfFileExists "$INSTDIR\resources\WinDivert64.sys" 0 skip_wd_sys
    CopyFiles /SILENT "$INSTDIR\resources\WinDivert64.sys" "$INSTDIR\WinDivert64.sys"
  skip_wd_sys:

  IfFileExists "$INSTDIR\horizon-gateway-serve.exe" skip_serve
  IfFileExists "$INSTDIR\resources\horizon-gateway-serve.exe" 0 skip_serve
    CopyFiles /SILENT "$INSTDIR\resources\horizon-gateway-serve.exe" "$INSTDIR\horizon-gateway-serve.exe"
  skip_serve:

  IfFileExists "$INSTDIR\hgc.exe" skip_hgc
  IfFileExists "$INSTDIR\resources\hgc.exe" 0 skip_hgc
    CopyFiles /SILENT "$INSTDIR\resources\hgc.exe" "$INSTDIR\hgc.exe"
  skip_hgc:

  IfFileExists "$INSTDIR\icon.ico" skip_icon
  IfFileExists "$INSTDIR\resources\icon.ico" 0 skip_icon
    CopyFiles /SILENT "$INSTDIR\resources\icon.ico" "$INSTDIR\icon.ico"
  skip_icon:

  ; Never prompt for PATH during silent/passive/auto-update installs.
  IfSilent skip_path
  IntCmp $UpdateMode 1 skip_path skip_path_ask skip_path_ask
  skip_path_ask:
  MessageBox MB_YESNO|MB_ICONQUESTION "Do you want to add Horizon Gateway to your environment variables (PATH)?$\r$\nThis allows you to run 'hgc' and 'horizon-gateway' from any terminal." IDNO skip_path
  nsExec::Exec `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$path = [System.Environment]::GetEnvironmentVariable('Path', 'User'); if ($path -split ';' -notcontains '$INSTDIR') { [System.Environment]::SetEnvironmentVariable('Path', ($path + ';$INSTDIR').Trim(';'), 'User') }"`
  skip_path:
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Stop headless backend, CLI and drivers before removing files.
  nsExec::Exec `taskkill /IM horizon-gateway.exe /F /T`
  nsExec::Exec `taskkill /IM horizon-gateway-serve.exe /F /T`
  nsExec::Exec `taskkill /IM hgc.exe /F /T`
  nsExec::Exec `net stop WinDivert`
  nsExec::Exec `sc stop WinDivert`
  Sleep 500
  nsExec::Exec `powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$path = [System.Environment]::GetEnvironmentVariable('Path', 'User'); $newPath = ($path -split ';' | Where-Object { $_ -ne '$INSTDIR' }) -join ';'; [System.Environment]::SetEnvironmentVariable('Path', $newPath, 'User')"`
!macroend
