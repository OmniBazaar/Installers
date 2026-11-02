/**
 * Invariants of the Windows packaging, as tests.
 *
 * These are cheap and they guard the two things that would be an ASK-class mistake
 * to ship: an installer that needs an administrator, and an uninstall that deletes a
 * node's on-chain identity without being asked. Both are text properties of the
 * `.iss` and of the staging script, so they can be asserted here without Windows.
 *
 * The bundle's completeness check is the reason `config/` and `pgsql/lib` are in the
 * list: each was found by running the installer, not by reading it.
 */

import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..", "listing-node-windows");

/**
 * Read one packaging file as text.
 * @param name - File name inside the packaging directory.
 * @returns Its contents.
 */
function read(name: string): string {
  return readFileSync(join(ROOT, name), "utf8");
}

describe("the NSIS installer", () => {
  const iss = read("omnibazaar-listing-node.nsi");

  it("installs for one user and never asks for elevation", () => {
    expect(iss).toContain("RequestExecutionLevel user");
    expect(iss).not.toContain("RequestExecutionLevel admin");
    expect(iss).toContain('InstallDir "$LOCALAPPDATA\\OmniBazaar\\ListingNode"');
    // Per-user context for Start Menu / Startup / registry.
    expect(iss).toContain("SetShellVarContext current");
  });

  it("writes nothing machine-wide", () => {
    // Directives, not prose: the header comment mentions these words to explain why
    // they are not used, and a test that greps prose would fail on its own rationale.
    for (const forbidden of [
      "WriteRegStr HKLM",
      "WriteRegDWORD HKLM",
      "$PROGRAMFILES",
      "$COMMONAPPDATA",
      "$COMMONPROGRAMS",
    ]) {
      expect(iss).not.toContain(forbidden);
    }
    // The uninstall entry is per user, which is what makes it removable by the
    // account that installed it.
    expect(iss).toContain("WriteRegStr HKCU");
    expect(iss).toContain("$SMPROGRAMS");
  });

  it("asks about deleting the data, and the default answer keeps it", () => {
    expect(iss).toContain("MB_DEFBUTTON2");
    expect(iss).toContain("IDNO keepData");
    // Silent uninstall cannot ask, so it must not delete.
    expect(iss).toContain("IfSilent keepData");
    // The deletion sits between the MessageBox and the label the NO answer jumps to,
    // so reaching it requires an explicit YES. (The label is after the block because
    // that is where the jump lands — reading it the other way round is the mistake
    // this assertion exists to prevent.)
    const jumpOnNo = iss.indexOf("IDNO keepData");
    const labelAt = iss.indexOf("keepData:");
    const deleteAt = iss.indexOf('RMDir /r "$INSTDIR\\data"');
    expect(jumpOnNo).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(jumpOnNo);
    expect(deleteAt).toBeLessThan(labelAt);
  });

  it("starts the node at logon from the user's own startup folder", () => {
    // Supervision without a service: a service needs an administrator and runs as an
    // account that does not own the database files.
    expect(iss).toContain("$SMSTARTUP");
    expect(iss).toContain("CreateShortCut");
  });

  it("captures the install output instead of a console window that closes", () => {
    // The first Windows install showed "could not start server" in a window that
    // vanished; nothing was left to read. ExecToLog streams into the installer's
    // detail pane, and the manager keeps its own log file.
    expect(iss).toContain("nsExec::ExecToLog");
    expect(iss).not.toMatch(/ExecWait '\"\$INSTDIR\\app\\\$\{APPEXE\}\" install/);
    expect(iss).toContain("logs\\install.log");
  });

  it("checks the install exit code and does not start a node that failed to install", () => {
    const install = iss.indexOf('install --root');
    const pop = iss.indexOf('Pop $0', install);
    const failBranch = iss.indexOf('The node could not finish installing');
    const start = iss.indexOf(' start --root');
    expect(pop).toBeGreaterThan(install);
    expect(failBranch).toBeGreaterThan(pop);
    // `start` is only reached through the success label.
    expect(start).toBeGreaterThan(failBranch);
    expect(iss).toContain('StrCmp $0 "0" installOk');
  });

  it("offers one diagnostic screen an operator can paste", () => {
    expect(iss).toContain('doctor --root');
  });

  it("stops the node before removing files", () => {
    const uninstall = iss.slice(iss.indexOf('Section "Uninstall"'));
    const stopAt = uninstall.indexOf("stop --root");
    const firstDeleteAt = uninstall.indexOf("RMDir /r");
    expect(stopAt).toBeGreaterThan(-1);
    expect(firstDeleteAt).toBeGreaterThan(stopAt);
  });

  it("runs the same manager the Linux installer drives", () => {
    expect(iss).toContain('"$INSTDIR\\app\\${APPEXE}" install --root "$INSTDIR"');
    expect(iss).toContain('"$INSTDIR\\app\\${APPEXE}" start --root "$INSTDIR"');
  });
});

describe("the staging script", () => {
  const script = read("build-bundle.mjs");

  it("requires the files whose absence breaks a first run", () => {
    // config/ is read at boot; pgsql/lib and pgsql/share are what initdb needs.
    expect(script).toContain("config/listing-node-surface.json");
    expect(script).toContain("pgsql/lib");
    expect(script).toContain("pgsql/share");
    expect(script).toContain("pgsql/bin/initdb.exe");
  });

  it("fails the build when the node was never built", () => {
    expect(script).toContain("npm run build");
  });

  it("installs production dependencies in the bundle rather than copying a workspace tree", () => {
    expect(script).toContain("--omit=dev");
  });
});
