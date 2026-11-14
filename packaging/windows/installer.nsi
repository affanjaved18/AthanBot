Unicode true
!include LogicLib.nsh
!include x64.nsh
Name "AthanBot"
OutFile "${output}"
InstallDir "$LOCALAPPDATA\Programs\AthanBot"
RequestExecutionLevel user
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
!if "${architecture}" == "arm64"
  ${Unless} ${IsNativeARM64}
    MessageBox MB_OK|MB_ICONSTOP "This installer requires Windows on ARM64."
    Abort
  ${EndUnless}
!else
  ${Unless} ${IsNativeAMD64}
    MessageBox MB_OK|MB_ICONSTOP "Use the installer for your computer's architecture."
    Abort
  ${EndUnless}
!endif
FunctionEnd

Section
  SetOutPath "$INSTDIR"
  File /r "${stage}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\AthanBot.lnk" "$INSTDIR\AthanBot.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AthanBot" "DisplayName" "AthanBot"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AthanBot" "DisplayVersion" "${version}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AthanBot" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AthanBot" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AthanBot" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\src\main.js" disable'
  Pop $0
  Pop $1
  StrCmp $0 "0" +3
  SetErrorLevel 2
  Abort "AthanBot could not remove its scheduled task ($0). $1"
  SetOutPath "$TEMP"
  ClearErrors
  Delete "$INSTDIR\AthanBot.exe"
  Delete "$INSTDIR\node.exe"
  IfErrors 0 +3
  SetErrorLevel 3
  Abort "Close AthanBot and try again."
  Delete "$SMPROGRAMS\AthanBot.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AthanBot"
  RMDir /r "$INSTDIR\src"
  RMDir /r "$INSTDIR\vendor"
  RMDir /r "$INSTDIR\audio"
  Delete "$INSTDIR\Node-LICENSE"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
