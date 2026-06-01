import { isNewerVersion, parseLatestOutput } from "../src/updates";

describe("isNewerVersion", () => {
  it("compares semver triples", () => {
    expect(isNewerVersion("1.2.0", "1.1.9")).toBe(true);
    expect(isNewerVersion("2.0.0", "1.9.9")).toBe(true);
    expect(isNewerVersion("1.0.1", "1.0.1")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(false);
  });

  it("ignores a leading v and pre-release suffix", () => {
    expect(isNewerVersion("v1.3.0", "1.2.0")).toBe(true);
    expect(isNewerVersion("1.2.0-rc.1", "1.2.0")).toBe(false);
  });
});

describe("parseLatestOutput", () => {
  it("parses a release record", () => {
    const r = parseLatestOutput(
      '{"version":"1.4.0","binaryHash":"0xab","minimumVersion":"1.0.0","revoked":false}',
    );
    expect(r.version).toBe("1.4.0");
    expect(r.revoked).toBe(false);
  });

  it("throws the CLI error", () => {
    expect(() =>
      parseLatestOutput('{"error":"No on-chain release found"}'),
    ).toThrow("No on-chain release found");
  });

  it("throws on malformed output", () => {
    expect(() => parseLatestOutput('{"version":"1.0.0"}')).toThrow(
      /Malformed/,
    );
  });
});
