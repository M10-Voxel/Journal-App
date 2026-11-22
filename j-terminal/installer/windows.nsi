Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "LogicLib.nsh"
!ifndef PRODUCT
!define PRODUCT "J-TerminaL"
!endif
!ifndef APPKEY
!define APPKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\j-terminal.exe"
!endif
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT}"
!define RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
Name "${PRODUCT} ${VERSION}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT}"
InstallDirRegKey HKCU "${UNKEY}" "InstallLocation"
ShowInstDetails show
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "German"
!insertmacro MUI_LANGUAGE "English"
LangString CloseFirst ${LANG_GERMAN} "Bitte J-TerminaL vollständig beenden und erneut versuchen."
LangString CloseFirst ${LANG_ENGLISH} "Please quit J-TerminaL and retry."

Section
  SetOutPath "$INSTDIR"
  File /oname=j-terminal.new.exe "${BINARY}"
retry:
  System::Call 'kernel32::MoveFileExW(w "$INSTDIR\j-terminal.new.exe", w "$INSTDIR\j-terminal.exe", i 1) i.r0'
  ${If} $0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseFirst)" /SD IDCANCEL IDRETRY retry
    Delete "$INSTDIR\j-terminal.new.exe"
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT}.lnk" "$INSTDIR\j-terminal.exe"
  WriteRegStr HKCU "${APPKEY}" "" "$INSTDIR\j-terminal.exe"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\j-terminal.exe"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${RUNKEY}" "${PRODUCT}" '"$INSTDIR\j-terminal.exe" --background'
SectionEnd

Section "Uninstall"
retry:
  ClearErrors
  Delete "$INSTDIR\j-terminal.exe"
  IfErrors 0 removed
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(CloseFirst)" /SD IDCANCEL IDRETRY retry
  SetErrorLevel 1
  Abort
removed:
  ReadRegStr $0 HKCU "${RUNKEY}" "${PRODUCT}"
  ${If} $0 == '"$INSTDIR\j-terminal.exe" --background'
    DeleteRegValue HKCU "${RUNKEY}" "${PRODUCT}"
  ${EndIf}
  ReadRegStr $0 HKCU "${APPKEY}" ""
  ${If} $0 == "$INSTDIR\j-terminal.exe"
    DeleteRegKey HKCU "${APPKEY}"
    DeleteRegKey HKCU "${UNKEY}"
    Delete "$SMPROGRAMS\${PRODUCT}.lnk"
  ${EndIf}
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
