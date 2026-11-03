/**
 * The three listing-node packages, built from one staged tree.
 *
 * What is worth pinning: the installer that ships inside the Linux and macOS archives
 * must delegate to the one manager (a second copy of a rule is the defect the whole
 * parity rule exists to prevent), it must refuse clearly when it cannot find a database
 * instead of half-installing, and a staged tree missing a part must fail on the build
 * machine rather than on an operator's first run.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(__dirname, "..", "listing-node", "build-artifacts.mjs");

/** Run the script with arguments. */
function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A directory that removes itself. */
let work = "";

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "obz-package-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/**
 * A Validator tree with the parts a bundle needs, and nothing else.
 * @param options - What to leave out.
 * @returns The path.
 */
function fakeValidator(options: { skip?: string[] } = {}): string {
  const validator = join(work, "Validator");
  const parts: Record<string, string[]> = {
    dist: ["listing-node.js", "cli/listingNodeManage.js", "api/ListingNodeConsole.js"],
    config: ["listing-node-surface.json"],
    migrations: ["listing-node/001_listings.sql", "listing-node/002_node_state.sql"],
    scripts: ["install-listing-node.sh"],
  };
  for (const [dir, files] of Object.entries(parts)) {
    if (options.skip?.includes(dir)) continue;
    for (const file of files) {
      const path = join(validator, dir, file);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "-- fake\n", "utf8");
    }
  }
  return validator;
}

describe("the package build", () => {
  it("refuses a tree with no build, and says what to run", () => {
    const result = run([
      "--validator",
      join(work, "nothing-here"),
      "--out",
      join(work, "out"),
      "--version",
      "1.2.3",
      "--platforms",
      "linux",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("npm run build");
  });

  it("says to build when a whole part is missing", () => {
    const result = run([
      "--validator",
      fakeValidator({ skip: ["config"] }),
      "--out",
      join(work, "out"),
      "--version",
      "1.2.3",
      "--platforms",
      "linux",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("build it first");
  });

  it("refuses an incomplete stage rather than shipping it", () => {
    // The parts are there but one file inside them is not — the case that would
    // otherwise install cleanly and fail on the operator's first start.
    const validator = fakeValidator();
    rmSync(join(validator, "dist", "api", "ListingNodeConsole.js"));
    const result = run([
      "--validator",
      validator,
      "--out",
      join(work, "out"),
      "--version",
      "1.2.3",
      "--platforms",
      "linux",
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("incomplete");
    expect(result.stderr).toContain("dist/api/ListingNodeConsole.js");
  });

  it("requires a version, because a package without one cannot be attested", () => {
    const result = run(["--validator", fakeValidator(), "--out", join(work, "out")]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--version");
  });
});

describe("the install script inside the archive", () => {
  it("delegates every decision to the manager", () => {
    // The rule that keeps three platforms identical. If this script ever grows a
    // schema load, a key, or a supervisor, that is the drift to refuse.
    const source = readFileSync(join(__dirname, "..", "listing-node", "build-artifacts.mjs"), "utf8");
    // Sliced rather than regexed: the script under test is a template literal, and a
    // regex written as a literal here would have to escape the same delimiters.
    const start = source.indexOf("#!/bin/sh");
    const end = source.indexOf("`;", start);
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, end);
    expect(body).toContain('"$node_bin" "$manager" install --root "$root"');
    // Installed *and* started: an installer that leaves a program installed but not
    // running is the one this project replaced.
    expect(body).toContain('"$node_bin" "$manager" start --root "$root"');
    // It may *look* for a bundled initdb; it must never run one, write a key, talk SQL
    // or manage a unit — those are the manager's, and a second copy drifts.
    expect(body).not.toContain('"$here/pgsql/bin/initdb" --');
    expect(body).not.toContain("NODE_PRIVATE_KEY");
    expect(body).not.toContain("psql -");
    expect(body).not.toContain("systemctl");
    expect(body).not.toContain("launchctl");
  });

  it("names the database requirement on each platform instead of failing obscurely", () => {
    const source = readFileSync(join(__dirname, "..", "listing-node", "build-artifacts.mjs"), "utf8");
    expect(source).toContain("brew install postgresql@16");
    expect(source).toContain("apt install postgresql-16");
    expect(source).toContain("OBZ_DB_URL");
  });

  it("offers a bundled Node runtime when the package contains one", () => {
    const source = readFileSync(join(__dirname, "..", "listing-node", "build-artifacts.mjs"), "utf8");
    expect(source).toContain('"$here/node/bin/node"');
  });
});

describe("signing and notarization", () => {
  it("signs before hashing, so the attested hash is the file an operator gets", () => {
    // Authenticode changes the bytes. Hash-then-sign publishes an attestation for a
    // file nobody receives; this asserts the order in the source because the mistake is
    // invisible in the output (both runs print a hash).
    const source = readFileSync(
      join(__dirname, "..", "listing-node", "build-artifacts.mjs"),
      "utf8",
    );
    const signAt = source.indexOf('options.signCommand !== undefined');
    const hashAt = source.indexOf("sha256: sha256(installer)");
    expect(signAt).toBeGreaterThan(-1);
    expect(hashAt).toBeGreaterThan(signAt);
    expect(source).toContain("verifySignature(installer)");
  });

  it("refuses to publish when the signature does not verify", () => {
    const source = readFileSync(
      join(__dirname, "..", "listing-node", "build-artifacts.mjs"),
      "utf8",
    );
    expect(source).toContain("Refusing to publish");
    expect(source).toContain('"/pa"');
  });

  it("ships macOS as a zip, because notarytool cannot accept a tarball", () => {
    const source = readFileSync(
      join(__dirname, "..", "listing-node", "build-artifacts.mjs"),
      "utf8",
    );
    expect(source).toContain('platform === "macos" ? ".zip" : ".tar.gz"');
  });

  it("has a notarization script that signs every Mach-O and refuses to guess", () => {
    const script = readFileSync(
      join(__dirname, "..", "listing-node", "macos-notarize.sh"),
      "utf8",
    );
    // The four steps Apple requires, in order.
    expect(script.indexOf("codesign --force --options runtime")).toBeLessThan(
      script.indexOf("notarytool submit"),
    );
    expect(script).toContain("--keychain-profile");
    expect(script).toContain("notarytool log");
    expect(script).toContain("spctl --assess");
    // It cannot run off a Mac, and says so rather than failing obscurely.
    expect(script).toContain('if [ "$(uname -s)" != "Darwin" ]');
    // A nested unsigned binary is the commonest rejection: it is checked before submit.
    expect(script).toContain("still unsigned");
  });
});
