; OmniBazaar listing node — Windows installer (NSIS 3).
;
; What this file is responsible for, and nothing more:
;   copy the staged bundle into the operator's own profile, put shortcuts in their
;   Start Menu, run the node's own `install` command, and make uninstall keep the
;   operator's data unless they explicitly ask for it to go.
;
; Everything else — creating the database cluster, applying the schema, writing the
; key and identity file, log rotation, start/stop/status — is
; `dist/cli/listingNodeManage.js`, the same program the Linux installer drives.
; There is deliberately no re-implementation of the installer here: a second copy
; drifts from the first within a release, and this platform only runs end-to-end
; inside a virtual machine.
;
; 🛑 NSIS rather than Inno Setup, decided on evidence: Inno's compiler only runs on
; Windows (its installer does not complete under Wine 6), so an Inno build could not
; be produced — or attested — by our own build host. NSIS compiles here, which means
; the hash we publish describes an artifact this pipeline actually built.
;
; TWO RULES THIS FILE MUST NOT BREAK:
;   1. `RequestExecutionLevel user`, and nothing written outside the user's profile.
;      A per-machine install needs elevation, and elevation is what stops an ordinary
;      person from running a node.
;   2. Uninstall must never delete the replica or the identity by default. The
;      identity holds the key the node's fees are paid to; removal of data is an
;      explicit second question whose default answer is NO.

Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif

!define APPNAME "OmniBazaar Listing Node"
!define APPEXE "obz-listing-node.cmd"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\OmniBazaarListingNode"

Name "${APPNAME}"
OutFile "omnibazaar-listing-node-${VERSION}-win-x64-setup.exe"
; Per-user install: never Program Files, never HKLM, never elevation.
InstallDir "$LOCALAPPDATA\OmniBazaar\ListingNode"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ShowInstDetails show

VIProductVersion "1.0.11.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "OmniBazaar"
VIAddVersionKey "FileDescription" "${APPNAME} installer"
VIAddVersionKey "FileVersion" "${VERSION}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "The node is installed and running"
!define MUI_FINISHPAGE_TEXT "Your node's address and next steps are in $INSTDIR\config\listing-node.env.$\r$\n$\r$\nRegistering the node on chain is a separate command: it needs a funded key, and this installer will not spend your gas."
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Spanish"

Section "Install"
  SetShellVarContext current
  ; Program files are split from the node's data on purpose: `app\` and `pgsql\` are
  ; the software (uninstall deletes them), while `data\`, `config\` and `logs\` are
  ; created at first run and are never touched by an uninstall.
  SetOutPath "$INSTDIR\app"
  File /r "out\app\*"
  SetOutPath "$INSTDIR\pgsql"
  File /r "out\pgsql\*"
  SetOutPath "$INSTDIR"

  ; First run: create the cluster, apply the schema, write the identity. The manager
  ; prints its own progress, and the installer waits because the node must not start
  ; before its database exists.
  DetailPrint "Creating the node's database and identity (this takes a minute) ..."
  ExecWait '"$INSTDIR\app\${APPEXE}" install --root "$INSTDIR"'

  DetailPrint "Starting the node ..."
  ExecWait '"$INSTDIR\app\${APPEXE}" start --root "$INSTDIR"'

  ; Start Menu (current user only).
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Start the node.lnk" "$INSTDIR\app\${APPEXE}" 'start --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Stop the node.lnk" "$INSTDIR\app\${APPEXE}" 'stop --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Status.lnk" "$INSTDIR\app\${APPEXE}" 'status --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\View the log.lnk" "$INSTDIR\app\${APPEXE}" 'logs --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0

  ; Comes back after a reboot without a service and without elevation: an entry in
  ; the user's own Startup folder. A Windows service would need an administrator and
  ; would run as an account that does not own the database files, so a per-user
  ; install and a service are mutually exclusive.
  CreateShortCut "$SMSTARTUP\OmniBazaar Listing Node.lnk" "$INSTDIR\app\${APPEXE}" 'start --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "OmniBazaar"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  ; Stop first, while the program still exists: PostgreSQL must be shut down rather
  ; than left holding an open handle in a directory about to be removed.
  ExecWait '"$INSTDIR\app\${APPEXE}" stop --root "$INSTDIR"'

  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\pgsql"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APPNAME}\Start the node.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Stop the node.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Status.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\View the log.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$SMSTARTUP\OmniBazaar Listing Node.lnk"

  DeleteRegKey HKCU "${UNINSTKEY}"

  ; 🛑 The data question. Default answer NO, and a silent uninstall (nobody to ask)
  ; never deletes. `data\` and `config\` are not part of the install, so they survive
  ; by themselves; this is the only place they can be removed.
  IfSilent keepData
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
    "Also delete this node's database and identity?$\r$\n$\r$\nThey are kept by default. The identity holds the key that identifies this node on chain, and fees already earned are paid to that address - deleting it cannot be undone." \
    IDNO keepData
  RMDir /r "$INSTDIR\data"
  RMDir /r "$INSTDIR\config"
  RMDir /r "$INSTDIR\logs"
  RMDir "$INSTDIR"
  Goto done
keepData:
  DetailPrint "Kept $INSTDIR\data and $INSTDIR\config"
done:
SectionEnd
