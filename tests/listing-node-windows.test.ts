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

describe("the Inno Setup installer", () => {
  const iss = read("omnibazaar-listing-node.iss");

  it("installs for one user and never asks for elevation", () => {
    expect(iss).toContain("PrivilegesRequired=lowest");
    expect(iss).toContain("PrivilegesRequiredOverridesAllowed=");
    expect(iss).not.toContain("PrivilegesRequired=admin");
    expect(iss).toContain("DefaultDirName={localappdata}\\OmniBazaar\\ListingNode");
  });

  it("writes nothing machine-wide", () => {
    // HKLM, {commonappdata}, {commonprograms} and the Program Files roots are the
    // machine-wide locations; any of them would need elevation to write.
    for (const forbidden of ["{commonappdata}", "{commonprograms}", "HKLM", "HKEY_LOCAL_MACHINE"]) {
      expect(iss).not.toContain(forbidden);
    }
    expect(iss).toContain("{userprograms}");
  });

  it("asks about deleting the data, and the default answer keeps it", () => {
    expect(iss).toContain("MB_DEFBUTTON2");
    expect(iss).toContain("IDYES then");
    // Silent uninstall cannot ask, so it must not delete.
    expect(iss).toContain("if not UninstallSilent then");
    // The deletion only happens when the operator said yes.
    expect(iss).toContain("if (CurUninstallStep = usPostUninstall) and PurgeData then");
  });

  it("starts the node at logon from the user's own startup folder", () => {
    // Supervision without a service: a service needs an administrator and runs as an
    // account that does not own the database files.
    expect(iss).toContain("{userstartup}");
    expect(iss).toMatch(/Parameters: "start"/);
    expect(iss).not.toContain("[Registry]");
  });

  it("stops the node before removing files", () => {
    expect(iss).toContain("[UninstallRun]");
    expect(iss).toMatch(/Parameters: "stop"/);
  });

  it("runs the same manager the Linux installer drives", () => {
    expect(iss).toMatch(/Parameters: "install"/);
    expect(iss).toContain("obz-listing-node.cmd");
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
