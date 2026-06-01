/**
 * Minimal semantic-version comparison primitives for installer/update tooling.
 *
 * Mirrors the parser used by the validator's `UpdateCheckService`; kept
 * self-contained so the standalone Installers package has no cross-package
 * import into Validator source. Semver math is a primitive, not shared
 * infrastructure — the shared infrastructure is the on-chain UpdateRegistry.
 *
 * @module shared/semver
 */

/** Numeric `[major, minor, patch]` tuple. */
export type SemverTuple = [number, number, number];

/**
 * Parse a semver string into numeric parts.
 * @param version - Version string, optionally prefixed with "v" (e.g. "v1.2.3").
 * @returns Tuple of `[major, minor, patch]`, or `undefined` when malformed.
 */
export function parseSemver(version: string): SemverTuple | undefined {
  const trimmed = version.trim().replace(/^v/i, "");
  const parts = trimmed.split(".");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || !Number.isInteger(n))) {
    return undefined;
  }
  return [nums[0], nums[1], nums[2] ?? 0];
}

/**
 * Compare two semver strings.
 * @param a - First version string.
 * @param b - Second version string.
 * @returns Negative if `a < b`, zero if equal (or either is malformed),
 *          positive if `a > b`.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === undefined || pb === undefined) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

/**
 * Determine whether a running version satisfies a minimum-version requirement.
 * @param current - The version currently installed/running.
 * @param minimum - The minimum required version (empty string means no minimum).
 * @returns `true` when `current >= minimum`, or when no minimum is set.
 */
export function meetsMinimum(current: string, minimum: string): boolean {
  if (minimum.trim() === "") return true;
  return compareSemver(current, minimum) >= 0;
}
