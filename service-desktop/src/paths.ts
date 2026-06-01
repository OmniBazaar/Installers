/**
 * Resolves the on-disk locations of bundled resources (the staged Validator
 * runtime, the shared artifact CLI, locale files) for both packaged and
 * development runs. Pure functions that take the electron-provided base paths as
 * arguments, so they are unit-tested without importing electron.
 *
 * @module paths
 */

import { join } from "path";

/** The base locations electron exposes, passed in to keep this module pure. */
export interface AppBasePaths {
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `process.resourcesPath` (valid when packaged). */
  resourcesPath: string;
  /** The app root directory (`app.getAppPath()`), used in development. */
  appPath: string;
}

/** Resolved absolute paths to bundled resources. */
export interface ResolvedPaths {
  /** Root of the staged Validator runtime bundle. */
  validatorRoot: string;
  /** The supervised service-node entry point. */
  serviceNodeEntry: string;
  /** The node-preflight script. */
  preflightScript: string;
  /** The staged Validator scripts directory (provisioning shell scripts). */
  scriptsDir: string;
  /** The bundled Validator production node_modules (for NODE_PATH). */
  validatorNodeModules: string;
  /** The shared artifact CLI entry. */
  artifactCli: string;
  /** Directory of bundled locale JSON files. */
  localesDir: string;
}

/**
 * Resolve bundled-resource paths. When packaged, resources live under
 * `process.resourcesPath` (per electron-builder `extraResources`); in
 * development they live under the repo working tree relative to `appPath`.
 *
 * @param base - The electron-provided base paths.
 * @returns Absolute {@link ResolvedPaths}.
 */
export function resolvePaths(base: AppBasePaths): ResolvedPaths {
  const validatorRoot = base.isPackaged
    ? join(base.resourcesPath, "validator")
    : join(base.appPath, "staging", "validator");
  const sharedRoot = base.isPackaged
    ? join(base.resourcesPath, "shared")
    : join(base.appPath, "staging", "shared");

  return {
    validatorRoot,
    serviceNodeEntry: join(validatorRoot, "dist", "service-node.js"),
    preflightScript: join(validatorRoot, "dist", "scripts", "node-preflight.js"),
    scriptsDir: join(validatorRoot, "scripts"),
    validatorNodeModules: join(validatorRoot, "node_modules"),
    artifactCli: join(sharedRoot, "cli.js"),
    localesDir: base.isPackaged
      ? join(base.resourcesPath, "locales")
      : join(base.appPath, "locales"),
  };
}
