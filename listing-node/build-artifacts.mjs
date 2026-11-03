#!/usr/bin/env node
/**
 * Build the three listing-node installers from one staged tree.
 *
 * One stage, three packages, because the node is one program: the same `app/` goes into
 * a Windows installer, a Linux archive and a macOS archive, and only the supervisor and
 * the PostgreSQL story differ. Building them from one script is what stops the three
 * drifting — the Windows bundle is already assembled by `build-bundle.mjs`, and this
 * calls it rather than copying its rules.
 *
 * What each package contains, and why:
 *
 * - **`app/`** — compiled `dist/`, `config/` (the surface manifest, read at boot),
 *   `migrations/listing-node/`, `package.json` and a **production** `node_modules`.
 *   The checkout's `node_modules` is hoisted to the monorepo root, so a copy is not a
 *   working tree; it is installed in the bundle directory instead.
 * - **`pgsql/`** — optional on Linux (a bundled PostgreSQL, when `--pg-dir` is given),
 *   never on macOS (Homebrew's `postgresql@16` is the documented path), always on
 *   Windows (by `build-bundle.mjs`).
 * - **`install.sh`** — chooses the database and calls the one manager. It contains no
 *   decisions: if this file ever grows a second copy of a rule, that rule will drift.
 *
 * The bundle is refused when a required part is missing, so a broken artefact fails
 * here, on the build machine, rather than on an operator's first run.
 *
 * Usage:
 *   node build-artifacts.mjs --validator ../../Validator --out ./out --version 1.0.25
 *   node build-artifacts.mjs … --platforms linux,macos --pg-dir /usr/lib/postgresql/16
 *   node build-artifacts.mjs … --platforms windows \
 *        --node-win-zip <zip> --pg-win-zip <zip>
 *
 * @module listing-node/build-artifacts
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Production dependencies the node actually loads. */
const RUNTIME_DEPS = {
  ethers: "^6.13.0",
  express: "^4.19.2",
  pg: "^8.11.5",
  winston: "^3.11.0",
};

/** Parts every `app/` must have, checked after staging. */
const REQUIRED_APP = [
  "dist/listing-node.js",
  "dist/cli/listingNodeManage.js",
  "dist/api/ListingNodeConsole.js",
  "config/listing-node-surface.json",
  "migrations/listing-node/001_listings.sql",
  "migrations/listing-node/002_node_state.sql",
  "package.json",
  "node_modules/express/package.json",
  "node_modules/pg/package.json",
  "node_modules/ethers/package.json",
];

/**
 * The install script shipped inside the Linux and macOS archives.
 *
 * It does three things and delegates everything else: pick the database, refuse to
 * guess when there is none, and call the manager. The refusal text is the documentation
 * for the one external dependency a stranger will hit.
 * @returns Shell script contents.
 */
export function installScript() {
  return `#!/bin/sh
# OmniBazaar listing node — installer for Linux and macOS.
#
# Everything after "which database" is the node's own manager, the same program the
# Windows installer runs, so the layout, the key, the schema and the autostart entry
# are identical on all three platforms.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# The package directory IS the install: extract the archive where you want the node
# to live, and everything it owns (app/, pgsql/, data/, config/, logs/) sits beside
# this script — the same shape the Windows installer creates in %LOCALAPPDATA%.
root="\${OBZ_ROOT:-$here}"
node_bin="\${OBZ_NODE:-}"
manager="$here/app/dist/cli/listingNodeManage.js"

if [ -z "$node_bin" ]; then
  if [ -x "$here/node/bin/node" ]; then
    node_bin="$here/node/bin/node"
  elif command -v node >/dev/null 2>&1; then
    node_bin=$(command -v node)
  else
    cat >&2 <<'MSG'
This package needs Node.js 20 or newer, and none was found.

  Option 1 (recommended): install Node from https://nodejs.org and run this again.
  Option 2: pass a Node installation with OBZ_NODE=/path/to/node, or place one in
            node/bin/node beside this script.

Nothing has been changed on this machine.
MSG
    exit 2
  fi
fi

db_args="--pg-port \${OBZ_PG_PORT:-55432}"
if [ -n "\${OBZ_DB_URL:-}" ]; then
  db_args="--db-url $OBZ_DB_URL"
elif [ -x "$here/pgsql/bin/initdb" ]; then
  # A bundled PostgreSQL: the manager creates the cluster inside the root.
  :
elif [ "$(uname -s)" = "Darwin" ]; then
  cat >&2 <<'MSG'
This package does not bundle PostgreSQL on macOS. Install it once, then run this again:

  brew install postgresql@16
  brew services start postgresql@16

Or point the installer at a server you already run:

  OBZ_DB_URL=postgres://user:password@127.0.0.1:5432/listing_node ./install.sh

Nothing has been changed on this machine.
MSG
  exit 2
else
  cat >&2 <<'MSG'
This package does not bundle PostgreSQL, and none was found.

  Option 1: install PostgreSQL 14 or newer (for example
            sudo apt install postgresql-16), then run this again.
  Option 2: run PostgreSQL in Docker, then point the installer at it:
            docker run -d --name obz-listing-pg -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:16
            OBZ_DB_URL=postgres://postgres:...@127.0.0.1:5432/postgres ./install.sh
  Option 3: use the package that bundles PostgreSQL, if one was offered for your system.

Nothing has been changed on this machine.
MSG
  exit 2
fi

# Install the node, then start it: an installer that leaves a program installed but
# not running is the installer this project replaced. Both steps are the manager's.
# shellcheck disable=SC2086
"$node_bin" "$manager" install --root "$root" $db_args
"$node_bin" "$manager" start --root "$root" $db_args

port=$("$node_bin" -e 'const p=process.argv[1];const fs=require("fs");const t=fs.readFileSync(p,"utf8");const m=/^NODE_PORT=(\d+)$/m.exec(t);process.stdout.write(m?m[1]:"3200")' "$root/config/listing-node.env" 2>/dev/null || echo 3200)
cat <<MSG

The node is running. Open your dashboard:

  http://127.0.0.1:$port/

Register it from there — the network pays the gas, so there is nothing to buy.
MSG
`;
}

/**
 * Print usage and exit.
 * @param message - Why.
 * @returns Never.
 */
function die(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/**
 * Parse `--flag value` pairs.
 * @param argv - Arguments.
 * @returns Options.
 */
export function parseArgs(argv) {
  const options = {
    validator: "",
    out: "",
    version: "",
    platforms: ["linux", "macos"],
    pgDir: undefined,
    pgShareDir: undefined,
    nodeRuntime: undefined,
    nodeWinZip: undefined,
    pgWinZip: undefined,
    tar: true,
    signCommand: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--validator":
        options.validator = value ?? "";
        i += 1;
        break;
      case "--out":
        options.out = value ?? "";
        i += 1;
        break;
      case "--version":
        options.version = value ?? "";
        i += 1;
        break;
      case "--platforms":
        options.platforms = (value ?? "").split(",").filter(Boolean);
        i += 1;
        break;
      case "--pg-dir":
        options.pgDir = value;
        i += 1;
        break;
      case "--pg-share-dir":
        options.pgShareDir = value;
        i += 1;
        break;
      case "--node-runtime":
        options.nodeRuntime = value;
        i += 1;
        break;
      case "--node-win-zip":
        options.nodeWinZip = value;
        i += 1;
        break;
      case "--pg-win-zip":
        options.pgWinZip = value;
        i += 1;
        break;
      case "--no-tar":
        options.tar = false;
        break;
      case "--sign-command":
        options.signCommand = value;
        i += 1;
        break;
      default:
        die(`Unknown option "${String(flag)}"`);
    }
  }
  if (options.validator === "") die("--validator <Validator dir> is required");
  if (options.out === "") die("--out <dir> is required");
  if (options.version === "") die("--version <x.y.z> is required");
  return options;
}

/**
 * Copy the compiled node and install its production dependencies.
 *
 * `npm install --omit=dev` in the bundle directory rather than copying the checkout's
 * `node_modules`: the checkout is a workspace member whose dependencies are hoisted to
 * the monorepo root, so a copy is not a working tree.
 * @param input - Source and destination.
 * @param input.validator - Validator directory.
 * @param input.app - Destination `app/` directory.
 * @param input.version - Version to stamp into the bundle's package.json.
 */
export function stageApp(input) {
  const { validator, app, version } = input;
  for (const part of ["dist", "config", "migrations", "scripts"]) {
    const from = join(validator, part);
    if (!existsSync(from)) die(`Validator has no ${part}/ — build it first (npm run build)`);
    cpSync(from, join(app, part), { recursive: true });
  }
  writeFileSync(
    join(app, "package.json"),
    `${JSON.stringify(
      { name: "omnibazaar-listing-node", private: true, version, dependencies: RUNTIME_DEPS },
      null,
      2,
    )}\n`,
    "utf8",
  );
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: app,
    stdio: "inherit",
  });
}

/**
 * Check the staged `app/` is loadable, and name what is missing.
 * @param app - Destination `app/` directory.
 */
export function assertAppComplete(app) {
  const missing = REQUIRED_APP.filter((part) => !existsSync(join(app, part)));
  if (missing.length > 0) {
    die(
      `The staged node is incomplete; refusing to build an installer that would fail on an operator's machine:\n` +
        missing.map((part) => `  missing ${part}`).join("\n"),
    );
  }
}

/**
 * SHA-256 of a file.
 * @param file - Path.
 * @returns Hex digest.
 */
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Confirm a signature is present and valid, or stop the build.
 *
 * A build that reports "signed" without checking is how an unsigned installer gets
 * published under a signed release's hash.
 * @param file - Signed artifact.
 */
function verifySignature(file) {
  const isWindows = file.endsWith(".exe") || file.endsWith(".dll");
  const argv = isWindows
    ? ["verify", "/pa", "/v", file]
    : ["--verify", "--verbose=2", file];
  const command = isWindows ? (process.env.OBZ_SIGNTOOL ?? "signtool") : "osslsigncode";
  try {
    execFileSync(command, argv, { stdio: "inherit" });
  } catch {
    die(
      `The signature on ${basename(file)} did not verify. Refusing to publish: an ` +
        `attested hash of an unsigned or broken installer is worse than no release.`,
    );
  }
}

/**
 * Everything in a directory, relative, sorted.
 * @param root - Directory.
 * @param base - Directory the paths are relative to.
 * @returns Relative paths.
 */
function walk(root, base = root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

/**
 * Entry point.
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const work = join(options.out, "listing-node");
  rmSync(work, { recursive: true, force: true });
  const app = join(work, "app");
  mkdirSync(app, { recursive: true });

  process.stderr.write("staging the node…\n");
  stageApp({ validator: options.validator, app, version: options.version });
  assertAppComplete(app);
  writeFileSync(join(work, "install.sh"), installScript(), { encoding: "utf8", mode: 0o755 });

  if (options.nodeRuntime !== undefined) {
    process.stderr.write("bundling the Node runtime…\n");
    cpSync(options.nodeRuntime, join(work, "node"), { recursive: true });
  }

  const artifacts = [];
  const targets = options.platforms;

  if (targets.includes("linux") || targets.includes("macos")) {
    if (options.pgDir !== undefined && targets.includes("linux")) {
      process.stderr.write("bundling PostgreSQL…\n");
      for (const part of ["bin", "lib", "share"]) {
        // A distribution that splits its layout (Debian: bin+lib under
        // /usr/lib/postgresql/N, share under /usr/share/postgresql/N) is supported by
        // naming the second root; initdb needs the dictionaries in share/ or it dies
        // with "could not access file $libdir/dict_snowball".
        const from =
          part === "share" && options.pgShareDir !== undefined
            ? options.pgShareDir
            : join(options.pgDir, part);
        if (!existsSync(from)) {
          die(`no PostgreSQL ${part}/ at ${from} — bundle bin, lib AND share (use --pg-share-dir for a split layout)`);
        }
        cpSync(from, join(work, "pgsql", part), { recursive: true });
      }
    } else {
      // Stated in the artefact list so the download page can say it too.
      process.stderr.write(
        "no --pg-dir: the Linux/macOS package expects PostgreSQL 14+ on the machine (documented in install.sh)\n",
      );
    }

    for (const platform of targets.filter((p) => p === "linux" || p === "macos")) {
      // macOS ships as .zip because notarytool accepts .dmg/.pkg/.zip and a bare
      // .tar.gz cannot be notarized at all. Linux stays .tar.gz.
      const suffix = platform === "macos" ? ".zip" : ".tar.gz";
      const name = `omnibazaar-listing-node-${options.version}-${platform}-${process.arch}${suffix}`;
      const file = join(options.out, name);
      // The Windows installer is a directory copy with its own shortcuts; the other
      // two are this archive plus install.sh, so the tree is identical apart from
      // the optional pgsql/ and node/ directories.
      if (platform === "macos") {
        // `-y` keeps the symlinks Node and PostgreSQL rely on; `-r` is not used on
        // purpose, so the payload stays a plain directory an operator can inspect.
        execFileSync("zip", ["-qry", file, "listing-node"], { cwd: options.out });
      } else {
        execFileSync("tar", ["czf", file, "-C", options.out, "listing-node"]);
      }
      artifacts.push({
        platform,
        file: name,
        sha256: sha256(file),
        size: statSync(file).size,
      });
    }
  }

  if (targets.includes("windows")) {
    process.stderr.write("building the Windows installer…\n");
    const bundle = join(HERE, "..", "listing-node-windows", "build-bundle.mjs");
    if (!existsSync(bundle)) die(`no build-bundle.mjs at ${bundle}`);
    const bundleOut = join(options.out, "windows-bundle");
    const args = [bundle, "--validator", options.validator, "--out", bundleOut];
    // The Windows bundle takes its two third-party inputs as paths or, failing that,
    // from these variables — reused rather than reinvented, so the release step and a
    // hand-run bundle cannot disagree about which zip is meant.
    execFileSync(process.execPath, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        ...(options.nodeWinZip === undefined
          ? {}
          : { NODE_WINDOWS_ZIP: options.nodeWinZip }),
        ...(options.pgWinZip === undefined ? {} : { PG_WINDOWS_ZIP: options.pgWinZip }),
      },
    });
    const installer = join(options.out, `omnibazaar-listing-node-${options.version}-win-x64-setup.exe`);
    execFileSync(
      "makensis",
      [
        `-DVERSION=${options.version}`,
        `-DOUTDIR=${options.out}`,
        `-DSRCDIR=${bundleOut}`,
        join(HERE, "..", "listing-node-windows", "omnibazaar-listing-node.nsi"),
      ],
      { cwd: join(HERE, "..", "listing-node-windows"), stdio: "inherit" },
    );
    if (!existsSync(installer)) die(`makensis did not produce ${installer}`);
    // 🛑 Sign BEFORE hashing. The on-chain attestation describes the bytes an operator
    // downloads, and Authenticode changes those bytes; hash-then-sign would publish an
    // attestation for a file nobody ever receives.
    if (options.signCommand !== undefined) {
      process.stderr.write(`signing ${basename(installer)}…\n`);
      execFileSync("sh", ["-c", `${options.signCommand} "$1"`, "sign", installer], {
        stdio: "inherit",
      });
      verifySignature(installer);
    }
    artifacts.push({
      platform: "windows",
      file: basename(installer),
      sha256: sha256(installer),
      size: statSync(installer).size,
    });
  }

  // The manifest the release step attests. Written here, next to the artefacts, so a
  // hash can never describe a file this run did not produce.
  writeFileSync(
    join(options.out, "listing-node-artifacts.json"),
    `${JSON.stringify({ version: options.version, artifacts }, null, 2)}\n`,
    "utf8",
  );
  process.stderr.write(
    `\n${artifacts.length} artifact(s):\n` +
      artifacts
        .map((a) => `  ${a.file}  ${String(a.size)} bytes  sha256 ${a.sha256}`)
        .join("\n") +
      "\n",
  );
  process.stdout.write(JSON.stringify({ version: options.version, artifacts }));
}

if (process.argv[1] !== undefined && basename(process.argv[1]) === "build-artifacts.mjs") {
  main();
}
