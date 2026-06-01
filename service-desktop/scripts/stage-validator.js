#!/usr/bin/env node
/**
 * Stage the Validator runtime bundle into staging/validator/ for electron-builder
 * to ship as an unpacked extraResource. Copies the built `dist/`, the production
 * `node_modules`, and the `WebApp/build/` static assets the service node serves.
 *
 * The staged directory is what the supervised `node dist/service-node.js` child
 * executes at runtime, and what the Phase-4 hot updater atomically swaps. Run via
 * `npm run stage:validator` (invoked by the dist:* scripts before packaging).
 *
 * This script is plain Node (no TS build step) so it can run in the prepack hook.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const VALIDATOR_DIR = path.join(REPO_ROOT, "Validator");
const WEBAPP_BUILD = path.join(REPO_ROOT, "WebApp", "build");
const INSTALLERS_DIR = path.resolve(__dirname, "..", "..");
const SHARED_DIST = path.join(INSTALLERS_DIR, "dist", "shared");
const STAGING_ROOT = path.resolve(__dirname, "..", "staging");
const STAGING = path.join(STAGING_ROOT, "validator");
const STAGING_SHARED = path.join(STAGING_ROOT, "shared");

/**
 * Copy a directory tree using the platform's fast native copy, falling back to
 * fs.cpSync. Throws if the source does not exist (a missing prerequisite must
 * fail the build loudly rather than ship an empty bundle).
 * @param {string} src Absolute source directory.
 * @param {string} dest Absolute destination directory.
 */
function copyTree(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(
      `Required source not found: ${src}. Build the Validator (npm run build) and WebApp first.`,
    );
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

/**
 * Produce a production-only node_modules tree for the Validator without mutating
 * the developer's working tree: install with --omit=dev into the staging area.
 */
function stageProductionNodeModules() {
  const destPkg = path.join(STAGING, "package.json");
  copyTree(path.join(VALIDATOR_DIR, "package.json"), destPkg);
  const lock = path.join(VALIDATOR_DIR, "package-lock.json");
  if (fs.existsSync(lock)) {
    copyTree(lock, path.join(STAGING, "package-lock.json"));
  }
  execFileSync(
    "npm",
    ["install", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts"],
    { cwd: STAGING, stdio: "inherit" },
  );
}

function main() {
  fs.rmSync(STAGING_ROOT, { recursive: true, force: true });
  fs.mkdirSync(STAGING, { recursive: true });

  copyTree(path.join(VALIDATOR_DIR, "dist"), path.join(STAGING, "dist"));
  copyTree(WEBAPP_BUILD, path.join(STAGING, "WebApp", "build"));
  // The dependency provisioner shells out to these at runtime (Yugabyte, etc.).
  copyTree(path.join(VALIDATOR_DIR, "scripts"), path.join(STAGING, "scripts"));
  copyTree(path.join(VALIDATOR_DIR, "systemd"), path.join(STAGING, "systemd"));
  stageProductionNodeModules();

  // Stage the Phase-0 shared artifact CLI (update check); it resolves `ethers`
  // at runtime via NODE_PATH into the Validator bundle's node_modules above.
  copyTree(SHARED_DIST, STAGING_SHARED);

  process.stdout.write(`Staged Validator + shared bundles into ${STAGING_ROOT}\n`);
}

main();
