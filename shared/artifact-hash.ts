/**
 * SHA-256 hashing of release artifacts. The resulting 0x-prefixed digest is
 * what gets published on-chain as `UpdateRegistry.ReleaseInfo.binaryHash` and
 * what the verifier recomputes at install/update time.
 *
 * @module shared/artifact-hash
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Compute the SHA-256 of a file as a 0x-prefixed lowercase hex string.
 * Streams the file so arbitrarily large artifacts use bounded memory.
 * @param filePath - Path to the artifact file.
 * @returns Promise resolving to the 0x-prefixed 32-byte hex digest.
 */
export function hashFile(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", (err) => reject(err));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(`0x${hash.digest("hex")}`));
  });
}

/**
 * Compute the SHA-256 of an in-memory buffer as a 0x-prefixed hex string.
 * @param data - The artifact bytes.
 * @returns The 0x-prefixed 32-byte hex digest.
 */
export function hashBuffer(data: Buffer): string {
  return `0x${createHash("sha256").update(data).digest("hex")}`;
}
