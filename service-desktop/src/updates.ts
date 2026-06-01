/**
 * Update check. Phase 2 surfaces whether a newer service-node release is
 * published on-chain; the download + signature/hash verify + atomic apply is
 * Phase 4 (OmniUpdaterService). The on-chain read reuses the Phase-0 shared
 * artifact CLI (`latest` command) rather than re-deriving registry access here:
 * the desktop spawns the bundled CLI with the staged Validator's `ethers`
 * resolvable via NODE_PATH.
 *
 * The JSON parser and version comparison are pure and unit-tested.
 *
 * @module updates
 */

import { execFile } from "child_process";

/** The latest on-chain release, as reported by the shared CLI `latest`. */
export interface LatestRelease {
  /** Latest published semantic version. */
  version: string;
  /** On-chain SHA-256 of that release's artifact. */
  binaryHash: string;
  /** Minimum version nodes must run. */
  minimumVersion: string;
  /** Whether the latest version is revoked. */
  revoked: boolean;
}

/** Outcome of an update check. */
export interface UpdateCheckResult {
  /** The currently running version. */
  current: string;
  /** The latest on-chain version. */
  latest: string;
  /** Whether `latest` is newer than `current` (and not revoked). */
  updateAvailable: boolean;
}

/**
 * Parse a semantic version into numeric [major, minor, patch]. Pre-release and
 * build metadata are ignored for the coarse "is newer" comparison.
 * @param version - A semver string (optionally `v`-prefixed).
 * @returns The numeric triple.
 */
function parseSemver(version: string): [number, number, number] {
  const core = version.replace(/^v/, "").split(/[-+]/)[0] ?? "";
  const parts = core.split(".").map((p) => Number.parseInt(p, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Whether `candidate` is strictly newer than `current`. Pure and unit-tested.
 * @param candidate - The version to test.
 * @param current - The baseline version.
 * @returns True when candidate > current.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) {
      return true;
    }
    if ((a[i] ?? 0) < (b[i] ?? 0)) {
      return false;
    }
  }
  return false;
}

/**
 * Parse the JSON line emitted by `omnibazaar-artifact latest`.
 * @param stdout - Raw stdout from the CLI.
 * @returns The parsed {@link LatestRelease}.
 */
export function parseLatestOutput(stdout: string): LatestRelease {
  const trimmed = stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Update check produced no parseable output: "${trimmed}"`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Update-check output was not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["error"] === "string") {
    throw new Error(record["error"]);
  }
  const { version, binaryHash, minimumVersion, revoked } = record;
  if (
    typeof version !== "string" ||
    typeof binaryHash !== "string" ||
    typeof minimumVersion !== "string" ||
    typeof revoked !== "boolean"
  ) {
    throw new Error("Malformed latest-release output");
  }
  return { version, binaryHash, minimumVersion, revoked };
}

/**
 * Check the on-chain registry for a newer service-node release.
 *
 * @param options - CLI location, node binary, NODE_PATH, component, current version.
 * @returns The {@link UpdateCheckResult}.
 */
export function checkForUpdate(options: {
  /** Path to the bundled shared `cli.js`. */
  cliPath: string;
  /** Path to the node binary (electron's, run as node). */
  nodePath: string;
  /** NODE_PATH where `ethers` resolves (staged Validator node_modules). */
  nodeModulesPath: string;
  /** On-chain component id, e.g. "service-node". */
  component: string;
  /** Currently running version. */
  currentVersion: string;
}): Promise<UpdateCheckResult> {
  return new Promise<UpdateCheckResult>((resolve, reject) => {
    execFile(
      options.nodePath,
      [options.cliPath, "latest", "--component", options.component],
      {
        timeout: 30000,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NODE_PATH: options.nodeModulesPath,
        },
      },
      (error, stdout, stderr) => {
        try {
          const latest = parseLatestOutput(stdout.trim() !== "" ? stdout : stderr);
          resolve({
            current: options.currentVersion,
            latest: latest.version,
            updateAvailable:
              !latest.revoked &&
              isNewerVersion(latest.version, options.currentVersion),
          });
        } catch (parseErr) {
          reject(
            parseErr instanceof Error
              ? parseErr
              : new Error(String(parseErr ?? error)),
          );
        }
      },
    );
  });
}
