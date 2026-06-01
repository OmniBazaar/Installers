/**
 * Install/update-time authenticity check: recompute an artifact's SHA-256 and
 * assert it matches the hash published on-chain in `UpdateRegistry`, that the
 * version is not revoked, and (when applicable) that it meets the enforced
 * minimum version.
 *
 * This is the trustless anchor for "validate authenticity when installing":
 * what a node ultimately trusts is the on-chain hash approved by the ODDAO
 * signer set (see `Coin/scripts/sign-release.js` + `publish-release.js`), not
 * a lone artifact signature that could be re-signed by a single compromised
 * key.
 *
 * @module shared/artifact-verifier
 */
import { hashFile } from "./artifact-hash";
import {
  EthersReleaseReader,
  type OnChainRelease,
  type ReleaseReader,
} from "./release-reader";
import { meetsMinimum } from "./semver";

/** Outcome of an artifact verification. */
export interface VerificationResult {
  /** True only when hash matches, version is not revoked, and minimum is met. */
  ok: boolean;
  /** Recomputed 0x-prefixed SHA-256 of the local artifact. */
  computedHash: string;
  /** Hash recorded on-chain for the resolved version (empty if none found). */
  onChainHash: string;
  /** The version verified (resolved latest, or the explicit version). */
  version: string;
  /** Whether the on-chain record marks this version revoked. */
  revoked: boolean;
  /** Human-readable reason when `ok` is false; empty when `ok`. */
  reason: string;
}

/** Options for {@link verifyArtifact}. */
export interface VerifyArtifactOptions {
  /** Path to the downloaded artifact to verify. */
  artifactPath: string;
  /** Component identifier as published on-chain (e.g. "validator"). */
  component: string;
  /** Specific version to verify against; when omitted, the latest is used. */
  version?: string;
  /** Inject a reader for testing; defaults to a mainnet ethers reader. */
  reader?: ReleaseReader;
}

/**
 * Verify a local artifact against the on-chain UpdateRegistry record.
 *
 * Never throws for an authenticity failure (returns `ok: false` with a
 * `reason`). The only thrown errors are unexpected local I/O faults from
 * hashing the file, which the caller cannot anticipate.
 *
 * @param options - Artifact path, component, optional version and reader.
 * @returns A {@link VerificationResult}.
 */
export async function verifyArtifact(
  options: VerifyArtifactOptions,
): Promise<VerificationResult> {
  const reader = options.reader ?? new EthersReleaseReader();
  const computedHash = (await hashFile(options.artifactPath)).toLowerCase();

  let release: OnChainRelease;
  try {
    release =
      options.version !== undefined
        ? await reader.getRelease(options.component, options.version)
        : await reader.getLatestRelease(options.component);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const versionSuffix =
      options.version !== undefined ? ` v${options.version}` : "";
    return {
      ok: false,
      computedHash,
      onChainHash: "",
      version: options.version ?? "",
      revoked: false,
      reason: `No on-chain release found for ${options.component}${versionSuffix}: ${message}`,
    };
  }

  const onChainHash = release.binaryHash.toLowerCase();
  const hashMatches = onChainHash === computedHash;

  let minimumMet = true;
  if (hashMatches && !release.revoked) {
    const minimum = await reader.getMinimumVersion(options.component);
    minimumMet = meetsMinimum(release.version, minimum);
  }

  const ok = hashMatches && !release.revoked && minimumMet;

  let reason = "";
  if (!hashMatches) {
    reason = `Hash mismatch: local ${computedHash} != on-chain ${onChainHash}`;
  } else if (release.revoked) {
    const detail = release.revokeReason ? `: ${release.revokeReason}` : "";
    reason = `Version ${release.version} is revoked${detail}`;
  } else if (!minimumMet) {
    reason = `Version ${release.version} is below the enforced minimum version`;
  }

  return {
    ok,
    computedHash,
    onChainHash,
    version: release.version,
    revoked: release.revoked,
    reason,
  };
}
