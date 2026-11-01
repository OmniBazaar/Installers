#!/usr/bin/env node
/**
 * build-bundle — assemble the tree the Windows installer ships, and prove it is
 * complete before anything is signed.
 *
 * The Windows product is one directory the installer copies into the operator's
 * profile and then hands to `obz-listing-node install`. Nothing is installed
 * machine-wide, nothing runs as an administrator, and nothing is fetched at install
 * time except what the bundle already contains.
 *
 * The bundle is staged here rather than inside the `.iss` because two of its
 * required parts were found the hard way, and a missing part must fail THIS step
 * (on the build machine, with a message) rather than an operator's first run:
 *
 *   1. **`config/listing-node-surface.json`** is read at boot by the node
 *      (`join(__dirname, "..", "config", …)`). A bundle without `config/` installs
 *      cleanly and then every start fails with `ENOENT … listing-node-surface.json`.
 *   2. **PostgreSQL needs `bin`, `lib` AND `share`.** Staging only `bin/` makes
 *      `initdb` die with `could not access file "$libdir/dict_snowball"`, because
 *      the text-search dictionaries are data files, not binaries.
 *
 * Usage:
 *   NODE_WINDOWS_ZIP=node-v20.18.0-win-x64.zip \
 *   PG_WINDOWS_ZIP=postgresql-16.4-1-windows-x64-binaries.zip \
 *     node build-bundle.mjs --validator ../../Validator --out ./out
 *
 * Give it extracted directories with `--node-runtime <dir>` / `--pg-dir <dir>`
 * instead of zips to skip extraction (which is what CI does with a cached runtime).
 *
 * @module listing-node-windows/build-bundle
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
import { join, relative } from "node:path";

/** Files and directories every bundle must contain, checked after staging. */
const REQUIRED = [
  "node.exe",
  "dist/listing-node.js",
  "dist/cli/listingNodeManage.js",
  "config/listing-node-surface.json",
  "migrations/listing-node/001_listings.sql",
  "migrations/listing-node/002_node_state.sql",
  "pgsql/bin/initdb.exe",
  "pgsql/bin/pg_ctl.exe",
  "pgsql/lib",
  "pgsql/share",
  "obz-listing-node.cmd",
];

/**
 * Parse the command line.
 * @param argv - Arguments after the script path.
 * @returns Options.
 */
function parseArgs(argv) {
  const options = { validator: "../../Validator", out: "./out", nodeRuntime: "", pgDir: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--validator" && value !== undefined) {
      options.validator = value;
      index += 1;
    } else if (flag === "--out" && value !== undefined) {
      options.out = value;
      index += 1;
    } else if (flag === "--node-runtime" && value !== undefined) {
      options.nodeRuntime = value;
      index += 1;
    } else if (flag === "--pg-dir" && value !== undefined) {
      options.pgDir = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument "${String(flag)}"`);
    }
  }
  return options;
}

/**
 * Iterate every file under a directory.
 * @param dir - Directory to walk.
 * @returns Absolute paths.
 */
function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

/**
 * SHA-256 of a file.
 * @param path - File to hash.
 * @returns Hex digest.
 */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Extract a zip into a directory.
 * @param zip - Archive path.
 * @param into - Destination directory.
 */
function unzip(zip, into) {
  mkdirSync(into, { recursive: true });
  if (process.platform === "win32") {
    execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -Force '${zip}' '${into}'`], {
      stdio: "inherit",
    });
  } else {
    execFileSync("unzip", ["-q", "-o", zip, "-d", into], { stdio: "inherit" });
  }
}

/**
 * Find a directory that contains `node.exe`, one level deep if needed (both the
 * Node zip and the PostgreSQL zip wrap everything in a versioned folder).
 * @param root - Directory to search.
 * @returns The directory holding `node.exe`, or "" when absent.
 */
function findNodeExe(root) {
  if (existsSync(join(root, "node.exe"))) return root;
  for (const entry of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    if (entry.isDirectory() && existsSync(join(root, entry.name, "node.exe"))) {
      return join(root, entry.name);
    }
  }
  return "";
}

/**
 * Find the directory holding `pgsql/bin/initdb.exe`, tolerating the wrapper folder
 * the PostgreSQL Windows archive uses (`pgsql/`).
 * @param root - Directory to search.
 * @returns The `pgsql` directory, or "" when absent.
 */
function findPgsql(root) {
  const candidates = [join(root, "pgsql"), root];
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "bin", "initdb.exe"))) return candidate;
  }
  for (const entry of existsSync(root) ? readdirSync(root, { withFileTypes: true }) : []) {
    if (!entry.isDirectory()) continue;
    const nested = join(root, entry.name, "pgsql");
    if (existsSync(join(nested, "bin", "initdb.exe"))) return nested;
  }
  return "";
}

/**
 * Copy the pieces of the Validator build the node needs at runtime.
 * @param validator - Path to the Validator checkout.
 * @param into - Bundle directory.
 */
function stageValidator(validator, into) {
  // Preconditions are the point of this script: a missing `dist/` means the build
  // never ran, and a bundle that skips it fails on the operator's machine instead.
  if (!existsSync(join(validator, "dist", "listing-node.js"))) {
    throw new Error(`${validator}/dist/listing-node.js is missing — run "npm run build" in Validator first`);
  }
  cpSync(join(validator, "dist"), join(into, "dist"), { recursive: true });
  cpSync(join(validator, "config"), join(into, "config"), { recursive: true });
  cpSync(join(validator, "migrations"), join(into, "migrations"), { recursive: true });

  writeFileSync(
    join(into, "package.json"),
    `${JSON.stringify(
      {
        name: "omnibazaar-listing-node",
        private: true,
        version: readVersion(validator),
        description: "OmniBazaar listing node",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

/**
 * Read the Validator's version, so the bundle and the release agree.
 * @param validator - Path to the Validator checkout.
 * @returns The version string.
 */
function readVersion(validator) {
  const parsed = JSON.parse(readFileSync(join(validator, "package.json"), "utf8"));
  return typeof parsed.version === "string" ? parsed.version : "0.0.0";
}

/**
 * Install the node's production dependencies into the bundle.
 *
 * This is deliberately `npm install --omit=dev` in the bundle directory rather than
 * a copy of the checkout's `node_modules`: the checkout is a workspace member whose
 * dependencies are hoisted to the monorepo root, so a copy is not a working tree.
 * @param into - Bundle directory.
 */
function installProductionDeps(into) {
  writeFileSync(
    join(into, "package.json"),
    `${JSON.stringify(
      {
        name: "omnibazaar-listing-node",
        private: true,
        version: "0.0.0",
        dependencies: { ethers: "^6.13.0", express: "^4.19.2", pg: "^8.11.5", winston: "^3.11.0" },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: into,
    stdio: "inherit",
  });
}

/**
 * Write the `.cmd` wrapper the Start Menu shortcut runs.
 * @param into - Bundle directory.
 */
function writeWrapper(into) {
  const content = [
    "@echo off",
    "rem OmniBazaar listing node — runs the manager with the bundled Node runtime.",
    "rem %~dp0 is the directory of this script, so the bundle can live anywhere.",
    `"%~dp0node.exe" "%~dp0dist\\cli\\listingNodeManage.js" %*`,
    "if errorlevel 1 pause",
    "",
  ].join("\r\n");
  writeFileSync(join(into, "obz-listing-node.cmd"), content, "utf8");
}

/**
 * Write the manifest the installer and the release both read.
 * @param into - Bundle directory.
 * @param files - Files to hash.
 */
function writeManifest(into, files) {
  const entries = files
    .map((file) => ({
      path: relative(into, file).split("\\").join("/"),
      sha256: sha256(file),
      bytes: statSync(file).size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    component: "listing-node",
    platform: "windows-x64",
    generatedAt: new Date().toISOString(),
    files: entries,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  };
  writeFileSync(join(into, "bundle-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

/**
 * Verify every required path exists, and say which are missing.
 * @param into - Bundle directory.
 */
function verifyRequired(into) {
  const missing = REQUIRED.filter((path) => !existsSync(join(into, path)));
  if (missing.length > 0) {
    throw new Error(
      `The bundle is incomplete. Missing:\n  ${missing.join("\n  ")}\n` +
        `The two that are easiest to forget: config/listing-node-surface.json (the node reads it at boot)\n` +
        `and pgsql/{lib,share} (initdb cannot run without them).`,
    );
  }
}

/** Entry point. */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const out = options.out;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const work = join(out, ".staging");
  mkdirSync(work, { recursive: true });

  let nodeRuntime = options.nodeRuntime;
  if (nodeRuntime === "" && process.env["NODE_WINDOWS_ZIP"]) {
    unzip(process.env["NODE_WINDOWS_ZIP"], join(work, "node"));
    nodeRuntime = findNodeExe(join(work, "node"));
  }
  if (nodeRuntime === "" || !existsSync(join(nodeRuntime, "node.exe"))) {
    throw new Error(
      "No Windows Node runtime. Pass --node-runtime <dir> or set NODE_WINDOWS_ZIP to the official win-x64 zip.",
    );
  }

  let pgDir = options.pgDir;
  if (pgDir === "" && process.env["PG_WINDOWS_ZIP"]) {
    unzip(process.env["PG_WINDOWS_ZIP"], join(work, "pg"));
    pgDir = findPgsql(join(work, "pg"));
  }
  if (pgDir === "" || !existsSync(join(pgDir, "bin", "initdb.exe"))) {
    throw new Error(
      "No Windows PostgreSQL distribution. Pass --pg-dir <pgsql> or set PG_WINDOWS_ZIP to the EDB win-x64 binaries zip.",
    );
  }

  // node.exe is copied next to the program, and the whole Node distribution's DLLs
  // with it: a lone node.exe fails on Windows with a missing-library dialog.
  for (const name of readdirSync(nodeRuntime)) {
    cpSync(join(nodeRuntime, name), join(out, name), { recursive: true });
  }
  // The runtime's node_modules (npm) is not needed by the node; drop it to keep the
  // installer small and to make the bundle's dependency surface auditable.
  rmSync(join(out, "node_modules", "npm"), { recursive: true, force: true });

  stageValidator(options.validator, out);
  installProductionDeps(out);
  writeWrapper(out);

  cpSync(join(pgDir, "bin"), join(out, "pgsql", "bin"), { recursive: true });
  cpSync(join(pgDir, "lib"), join(out, "pgsql", "lib"), { recursive: true });
  cpSync(join(pgDir, "share"), join(out, "pgsql", "share"), { recursive: true });

  rmSync(work, { recursive: true, force: true });
  verifyRequired(out);
  const manifest = writeManifest(out, walk(out));
  process.stdout.write(
    `staged ${String(manifest.files.length)} files, ${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB, into ${out}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
