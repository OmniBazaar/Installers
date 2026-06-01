import { parsePreflightOutput } from "../src/preflight";

describe("parsePreflightOutput", () => {
  it("parses a valid result", () => {
    const result = parsePreflightOutput(
      '{"address":"0xabc","ownerPublicKey":"0x04de","nodeType":"service"}\n',
    );
    expect(result.address).toBe("0xabc");
    expect(result.nodeType).toBe("service");
  });

  it("throws the script's error message", () => {
    expect(() =>
      parsePreflightOutput('{"error":"--password is required"}'),
    ).toThrow("--password is required");
  });

  it("throws on unparseable output", () => {
    expect(() => parsePreflightOutput("not json")).toThrow(
      /no parseable output/,
    );
  });

  it("throws on missing fields", () => {
    expect(() => parsePreflightOutput('{"address":"0xabc"}')).toThrow(
      /missing required fields/,
    );
  });
});
