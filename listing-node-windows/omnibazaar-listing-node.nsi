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
; Build output, not source: `dist/` is gitignored, so a 52 MB installer can
; never look like a source change again.
OutFile "dist\omnibazaar-listing-node-${VERSION}-win-x64-setup.exe"
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
  ; State the destination in the window before copying anything: the first Windows
  ; report could not say which directory the installer chose, and this one line
  ; answers it without asking the operator to hunt through AppData.
  DetailPrint "Installing to: $INSTDIR"

  ; A breadcrumb outside the install, so "where did it go" is answerable even if the
  ; install directory is later removed or never visible to the account being checked.
  FileOpen $9 "$TEMP\omnibazaar-install-path.txt" w
  FileWrite $9 "$INSTDIR"
  FileClose $9
  DetailPrint "Path recorded in: $TEMP\omnibazaar-install-path.txt"

  SetOutPath "$INSTDIR\app"
  File /r "out\app\*"
  SetOutPath "$INSTDIR\pgsql"
  File /r "out\pgsql\*"
  SetOutPath "$INSTDIR"

  ; 🛑 Prove the copy happened before claiming anything about a database. A report of
  ; "no folder exists" after a successful-looking install cannot be reproduced here,
  ; and the honest response is to make the installer check its own work instead of
  ; trusting that it worked.
  IfFileExists "$INSTDIR\app\node.exe" copyOk
    MessageBox MB_ICONSTOP|MB_OK \
      "The installer could not write its files to:$\r$\n$INSTDIR$\r$\n$\r$\nThis usually means antivirus or Controlled Folder Access blocked it. Add an exclusion for $LOCALAPPDATA\OmniBazaar and run the installer again."
    Abort
  copyOk:
  DetailPrint "Files copied to $INSTDIR ($INSTDIR\app\node.exe present)"

  ; First run: create the cluster, apply the schema, write the identity.
  ;
  ; `nsExec::ExecToLog` and not `ExecWait`: ExecWait on a .cmd opens a console window
  ; that closes with its output, which is how the first Windows install ended with
  ; "could not start server" and nothing to read. This streams the manager's output
  ; into the installer's own detail pane AND leaves the manager's log file. The exit
  ; code is CHECKED: a failed install must not be followed by "start", whose "no
  ; identity" message is what hid the real error last time.
  DetailPrint "Log file: $INSTDIR\logs\install.log"
  DetailPrint "Creating the node's database and identity (this takes a minute) ..."
  nsExec::ExecToLog '"$INSTDIR\app\${APPEXE}" install --root "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" installOk

  MessageBox MB_ICONSTOP|MB_OK \
    "The node could not finish installing.$\r$\n$\r$\nThe details are in:$\r$\n$INSTDIR\logs\install.log$\r$\n$\r$\nSend that file, plus the folder listing of $INSTDIR. Nothing was sent on chain and no key was created."
  Goto afterStart

  installOk:
  DetailPrint "Starting the node ..."
  nsExec::ExecToLog '"$INSTDIR\app\${APPEXE}" start --root "$INSTDIR"'
  Pop $0
  StrCmp $0 "0" afterStart
  MessageBox MB_ICONEXCLAMATION|MB_OK \
    "The node installed but did not start.$\r$\n$\r$\nUse the Start Menu entry, or open $INSTDIR\logs\install.log for the reason."

  afterStart:

  ; Start Menu (current user only).
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  ; The console is the answer to "it installed and then said nothing": one page that
  ; shows the identity, how many listings the replica holds, the sync cursor, the
  ; configuration and the log, and links to the application for anything to do with
  ; the account.
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Open dashboard.lnk" "$INSTDIR\app\${APPEXE}" 'dashboard --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Start the node.lnk" "$INSTDIR\app\${APPEXE}" 'start --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Stop the node.lnk" "$INSTDIR\app\${APPEXE}" 'stop --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Status.lnk" "$INSTDIR\app\${APPEXE}" 'status --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\View the log.lnk" "$INSTDIR\app\${APPEXE}" 'logs --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0
  ; One screen an operator can paste into a message when something is wrong: paths,
  ; writability, whether the database and the identity exist, and what is on the ports.
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Diagnose.lnk" "$INSTDIR\app\${APPEXE}" 'doctor --root "$INSTDIR"' "$INSTDIR\app\node.exe" 0

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

  Delete "$SMPROGRAMS\${APPNAME}\Open dashboard.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Start the node.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Stop the node.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Status.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\View the log.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Diagnose.lnk"
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
