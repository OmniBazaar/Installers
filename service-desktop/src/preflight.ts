/**
 * Launcher-side wrapper around the bundled Validator `node-preflight.js` script.
 * Spawns it to derive the operator's public address from credentials (the
 * single source of derivation lives in Validator's KeyDerivationService — the
 * launcher reimplements nothing). The JSON parser is pure and unit-tested.
 *
 * @module preflight
 */

import { execFile } from "child_process";

/** Public preflight result returned by the bundled script. */
export interface PreflightResult {
  /** Derived owner address. */
  address: string;
  /** Owner public key. */
  ownerPublicKey: string;
  /** Node type echoed back. */
  nodeType: "service" | "gateway";
}

/**
 * Parse the JSON line emitted by `node-preflight.js`. Throws with the script's
 * own error message when it reported a failure, or a generic message when the
 * output is unparseable.
 *
 * @param stdout - Raw stdout from the preflight process.
 * @returns The parsed {@link PreflightResult}.
 */
export function parsePreflightOutput(stdout: string): PreflightResult {
  const trimmed = stdout.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`Preflight produced no parseable output: "${trimmed}"`);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Preflight output was not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record["error"] === "string") {
    throw new Error(record["error"]);
  }
  const { address, ownerPublicKey, nodeType } = record;
  if (
    typeof address !== "string" ||
    typeof ownerPublicKey !== "string" ||
    (nodeType !== "service" && nodeType !== "gateway")
  ) {
    throw new Error("Preflight output missing required fields");
  }
  return { address, ownerPublicKey, nodeType };
}

/**
 * Run the bundled preflight script to derive the operator's public address.
 *
 * @param options - Script path, node binary, and credentials.
 * @returns The derived {@link PreflightResult}.
 */
export function runPreflight(options: {
  /** Absolute path to the bundled `node-preflight.js`. */
  scriptPath: string;
  /** Path to the `node` binary. */
  nodePath: string;
  /** Account username. */
  username: string;
  /** Account password. */
  password: string;
  /** Node type. Defaults to "service". */
  nodeType?: "service" | "gateway";
}): Promise<PreflightResult> {
  const nodeType = options.nodeType ?? "service";
  return new Promise<PreflightResult>((resolve, reject) => {
    execFile(
      options.nodePath,
      [
        options.scriptPath,
        "--username",
        options.username,
        "--password",
        options.password,
        "--node-type",
        nodeType,
      ],
      { timeout: 30000 },
      (error, stdout, stderr) => {
        // The script encodes failures as JSON on stderr with exit 1; prefer the
        // structured stream that has content so the parser surfaces its message.
        const payload = stdout.trim() !== "" ? stdout : stderr;
        try {
          resolve(parsePreflightOutput(payload));
        } catch (parseError) {
          reject(
            parseError instanceof Error
              ? parseError
              : new Error(String(parseError ?? error)),
          );
        }
      },
    );
  });
}
