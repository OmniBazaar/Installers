/**
 * Unit tests for the artifact verifier. Mocks only the on-chain boundary via
 * an injected {@link ReleaseReader}; the hashing and decision logic run for
 * real over a real temp file.
 * @module tests/artifact-verifier
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBuffer } from "../shared/artifact-hash";
import { verifyArtifact } from "../shared/artifact-verifier";
import type { OnChainRelease, ReleaseReader } from "../shared/release-reader";

/** A reader that returns a fixed release (or throws), for testing. */
class FakeReader implements ReleaseReader {
  /**
   * @param release - The release to return, or an Error to throw.
   * @param minimum - The minimum version to report.
   */
  constructor(
    private readonly release: OnChainRelease | Error,
    private readonly minimum: string = "",
  ) {}

  /** @inheritdoc */
  async getLatestRelease(): Promise<OnChainRelease> {
    if (this.release instanceof Error) throw this.release;
    return this.release;
  }

  /** @inheritdoc */
  async getRelease(): Promise<OnChainRelease> {
    return this.getLatestRelease();
  }

  /** @inheritdoc */
  async getMinimumVersion(): Promise<string> {
    return this.minimum;
  }
}

/** Write a temp artifact and return its path plus its true SHA-256. */
async function makeArtifact(
  contents: string,
): Promise<{ path: string; hash: string }> {
  const buf = Buffer.from(contents, "utf8");
  const path = join(
    await fs.mkdtemp(join(tmpdir(), "obz-artifact-")),
    "artifact.bin",
  );
  await fs.writeFile(path, buf);
  return { path, hash: hashBuffer(buf) };
}

/** Build an OnChainRelease with field overrides for tests. */
function release(over: Partial<OnChainRelease>): OnChainRelease {
  return {
    version: "1.0.0",
    binaryHash: "0x00",
    minimumVersion: "",
    revoked: false,
    revokeReason: "",
    ...over,
  };
}

describe("verifyArtifact", () => {
  it("accepts a matching, non-revoked, minimum-satisfying artifact", async () => {
    const { path, hash } = await makeArtifact("validator-bundle-v1");
    const reader = new FakeReader(
      release({ version: "1.0.0", binaryHash: hash }),
      "1.0.0",
    );
    const result = await verifyArtifact({
      artifactPath: path,
      component: "validator",
      reader,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe("");
    expect(result.computedHash).toBe(hash.toLowerCase());
  });

  it("rejects a tampered artifact (hash mismatch)", async () => {
    const { path } = await makeArtifact("tampered-bytes");
    const reader = new FakeReader(
      release({ binaryHash: "0xdeadbeef" }),
    );
    const result = await verifyArtifact({
      artifactPath: path,
      component: "validator",
      reader,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Hash mismatch");
  });

  it("rejects a revoked version even when the hash matches", async () => {
    const { path, hash } = await makeArtifact("revoked-build");
    const reader = new FakeReader(
      release({ binaryHash: hash, revoked: true, revokeReason: "CVE-2026-1" }),
    );
    const result = await verifyArtifact({
      artifactPath: path,
      component: "validator",
      reader,
    });
    expect(result.ok).toBe(false);
    expect(result.revoked).toBe(true);
    expect(result.reason).toContain("revoked");
    expect(result.reason).toContain("CVE-2026-1");
  });

  it("rejects a version below the enforced minimum", async () => {
    const { path, hash } = await makeArtifact("old-build");
    const reader = new FakeReader(
      release({ version: "1.0.0", binaryHash: hash }),
      "2.0.0",
    );
    const result = await verifyArtifact({
      artifactPath: path,
      component: "validator",
      reader,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("minimum");
  });

  it("returns ok:false (not throw) when no on-chain release exists", async () => {
    const { path } = await makeArtifact("orphan-build");
    const reader = new FakeReader(new Error("VersionNotFound"));
    const result = await verifyArtifact({
      artifactPath: path,
      component: "validator",
      reader,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("No on-chain release found");
  });
});
