; OmniBazaar listing node — Windows installer (Inno Setup 6).
;
; What this file is responsible for, and nothing more:
;   copy the staged bundle into the operator's own profile, put shortcuts in their
;   Start Menu, run the node's own `install` command, and make uninstall keep the
;   operator's data unless they explicitly ask for it to go.
;
; Everything else — creating the database cluster, applying the schema, writing the
; key and identity file, log rotation, start/stop/status — is
; `dist/cli/listingNodeManage.js`, the same program the Linux installer drives.
; There is deliberately no PowerShell re-implementation of the installer here: a
; second implementation drifts from the first within a release, and this platform
; runs end-to-end only inside a virtual machine, which is the worst place to keep
; the only copy of the logic.
;
; TWO RULES THIS FILE MUST NOT BREAK:
;   1. `PrivilegesRequired=lowest`, and nothing written outside the user's profile.
;      A per-machine install needs elevation, and elevation is the thing that stops
;      an ordinary person from running a node.
;   2. Uninstall must never delete the replica or the identity by default. The
;      identity holds the key that identifies this node on chain, and fees already
;      earned are paid to that address; removal of data is an explicit second
;      question whose default is NO.

#define AppName "OmniBazaar Listing Node"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppPublisher "OmniBazaar"
#define AppExe "obz-listing-node.cmd"

[Setup]
AppId={{7E1B9A54-2C4E-4E4B-9C1D-6E5B2F0A9C31}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\OmniBazaar\ListingNode
DefaultGroupName={#AppName}
; No elevation, ever. The database cluster, the key and the logs all live here, which
; is why a per-user install is the only shape that works.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=
; The bundled PostgreSQL is win-x64.
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
DisableDirPage=no
OutputBaseFilename=omnibazaar-listing-node-{#AppVersion}-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#AppName}
SetupLogging=yes
; Signed with Authenticode after packaging. The key is cloud-held and signing is a
; founder-gated step, so this file does not pretend to do it.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Files]
; The staged bundle from build-bundle.mjs: dist/, config/, migrations/, node.exe
; with its DLLs, node_modules/ and pgsql/.
Source: "out\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\{#AppName}\Start the node"; Filename: "{app}\{#AppExe}"; Parameters: "start"; Comment: "Start the listing node"
Name: "{userprograms}\{#AppName}\Stop the node"; Filename: "{app}\{#AppExe}"; Parameters: "stop"; Comment: "Stop the listing node"
Name: "{userprograms}\{#AppName}\Status"; Filename: "{app}\{#AppExe}"; Parameters: "status"; Comment: "What is running right now"
Name: "{userprograms}\{#AppName}\View the log"; Filename: "{app}\{#AppExe}"; Parameters: "logs"; Comment: "The node's own log"
; Comes back after a reboot without a service and without elevation: a logon entry in
; the user's own Start Menu. A Windows service would need an administrator and would
; run as a different account than the one that owns the database files, so this is
; the only supervision shape consistent with a per-user install.
Name: "{userstartup}\OmniBazaar Listing Node"; Filename: "{app}\{#AppExe}"; Parameters: "start"; Comment: "Start the listing node at logon"

[Run]
; First run: create the cluster, apply the schema, write the identity. Hidden because
; the manager prints its own progress, and waited on because the node must not start
; before its database exists.
Filename: "{app}\{#AppExe}"; Parameters: "install"; StatusMsg: "Creating the node's database and identity (this takes a minute) ..."; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExe}"; Parameters: "start"; StatusMsg: "Starting the node ..."; Flags: runhidden waituntilterminated

[UninstallRun]
; Stop cleanly before files are removed, so PostgreSQL is shut down rather than left
; holding an open handle in a directory Inno is about to delete.
Filename: "{app}\{#AppExe}"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopNode"

[Code]
var
  PurgeData: Boolean;

// InitializeUninstall runs before anything is removed, which is the only point at
// which the operator can be asked. UninstallSilent is an unattended removal: nobody
// is there to answer, so the safe answer ("keep") is taken without asking.
function InitializeUninstall(): Boolean;
begin
  PurgeData := False;
  if not UninstallSilent then
  begin
    if MsgBox('Also delete this node''s database and identity?' + #13#10 + #13#10 +
              'They are kept by default. The identity holds the key that identifies ' +
              'this node on chain, and fees already earned are paid to that address - ' +
              'deleting it cannot be undone.',
              mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      PurgeData := True;
  end;
  Result := True;
end;

// Inno removes only the files it installed, so data\, config\ and logs\ survive an
// uninstall by themselves. This is the explicit deletion, done after the program is
// gone: it cannot call the manager any more and must not need to.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and PurgeData then
  begin
    DelTree(ExpandConstant('{app}\data'), True, True, True);
    DelTree(ExpandConstant('{app}\config'), True, True, True);
    DelTree(ExpandConstant('{app}\logs'), True, True, True);
  end;
end;
