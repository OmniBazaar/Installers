#!/usr/bin/env node
/**
 * Stage the Validator runtime bundle into staging/validator/ for electron-builder
 * to ship as an unpacked extraResource. Copies the built `dist/`, a production
 * `node_modules` resolved on the build host, and the `WebApp/build/` static
 * assets the service node serves.
 *
 * The staged directory is what the supervised `node dist/service-node.js` child
 * executes at runtime, and what the Phase-4 hot updater atomically swaps. Run via
 * `npm run stage:validator` (invoked by the dist:* scripts before packaging).
 *
 * Two monorepo-specific wrinkles are handled so a self-contained `npm install`
 * succeeds outside the workspace:
 *   - Vendored deps pinned to `file:vendor-tarballs/*.tgz` — the tarball dir is
 *     copied alongside the manifest (paths resolve relative to it).
 *   - Workspace-internal `@omnibazaar/*` deps — unpublished (so a registry
 *     install 404s) AND shipped as TypeScript source (main → src/index.ts, which
 *     only loads on a Node that strips types, 22.18+; Electron 32 bundles Node 20
 *     and the Linux installer provisions Node 20, neither of which can). Each is
 *     transpiled to CommonJS with esbuild and staged as a `file:` dependency.
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
const ROOT_NODE_MODULES = path.join(REPO_ROOT, "node_modules");
// Resolve esbuild from wherever Node finds it (service-desktop's own devDependency,
// else the hoisted workspace copy) so staging never depends on a transitive hoist.
const ESBUILD = path.join(
  path.dirname(require.resolve("esbuild/package.json")),
  "bin",
  "esbuild",
);
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
 * Transpile each workspace-internal `@omnibazaar/*` runtime dependency to a
 * self-contained CommonJS bundle under `staging/validator/vendor-internal/` and
 * repoint the dependency to that path, so the build-host `npm install` resolves
 * it without the public registry (it is unpublished) and the staged runtime
 * loads it on any Node version (no TypeScript stripping required).
 *
 * @param {Record<string, string>} deps - Validator dependency map; mutated in
 *   place so each internal dep points at its staged `file:` location.
 */
function stageInternalPackages(deps) {
  for (const name of Object.keys(deps)) {
    if (!name.startsWith("@omnibazaar/")) {
      continue;
    }
    // Workspace packages are symlinked into the monorepo node_modules.
    const linked = path.join(ROOT_NODE_MODULES, name);
    const srcPkgPath = path.join(linked, "package.json");
    if (!fs.existsSync(srcPkgPath)) {
      throw new Error(
        `Internal dep ${name} not resolvable at ${linked}. Run a workspace install first.`,
      );
    }
    const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, "utf8"));
    const entry = path.join(linked, srcPkg.main || "./src/index.ts");
    const shortName = name.slice("@omnibazaar/".length);
    const destDir = path.join(STAGING, "vendor-internal", shortName);
    fs.mkdirSync(destDir, { recursive: true });
    execFileSync(
      ESBUILD,
      [
        entry,
        "--bundle",
        "--platform=node",
        "--format=cjs",
        `--outfile=${path.join(destDir, "index.js")}`,
      ],
      { stdio: "inherit" },
    );
    fs.writeFileSync(
      path.join(destDir, "package.json"),
      `${JSON.stringify({ name, version: srcPkg.version, main: "index.js" }, null, 2)}\n`,
    );
    deps[name] = `file:./vendor-internal/${shortName}`;
  }
}

/**
 * Write the staged manifest (with internal deps repointed to their built
 * `file:` bundles) and resolve a production-only `node_modules` on the build
 * host. The developer's Validator/package.json is never mutated.
 */
function stageManifest() {
  const srcPkg = JSON.parse(
    fs.readFileSync(path.join(VALIDATOR_DIR, "package.json"), "utf8"),
  );
  const deps = srcPkg.dependencies || {};
  stageInternalPackages(deps);
  srcPkg.dependencies = deps;
  fs.writeFileSync(
    path.join(STAGING, "package.json"),
    `${JSON.stringify(srcPkg, null, 2)}\n`,
  );
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
  // Vendored deps pin `file:vendor-tarballs/*.tgz` relative to the manifest, so
  // the tarballs must travel with it or `npm install` fails with ENOENT.
  const vendorTarballs = path.join(VALIDATOR_DIR, "vendor-tarballs");
  if (fs.existsSync(vendorTarballs)) {
    copyTree(vendorTarballs, path.join(STAGING, "vendor-tarballs"));
  }
  stageManifest();

  // Stage the Phase-0 shared artifact CLI (update check). It resolves `ethers`
  // via NODE_PATH into the Validator bundle's node_modules at runtime.
  copyTree(SHARED_DIST, STAGING_SHARED);

  process.stdout.write(`Staged Validator + shared bundles into ${STAGING_ROOT}\n`);
}

main();
