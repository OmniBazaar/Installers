/**
 * Unit tests for the semver primitives.
 * @module tests/semver
 */
import { compareSemver, meetsMinimum, parseSemver } from "../shared/semver";

describe("parseSemver", () => {
  it("parses major.minor.patch", () => {
    expect(parseSemver("1.2.3")).toEqual([1, 2, 3]);
  });

  it("parses major.minor with implicit patch 0", () => {
    expect(parseSemver("1.2")).toEqual([1, 2, 0]);
  });

  it("strips a leading v", () => {
    expect(parseSemver("v2.0.1")).toEqual([2, 0, 1]);
  });

  it("rejects malformed input", () => {
    expect(parseSemver("")).toBeUndefined();
    expect(parseSemver("1")).toBeUndefined();
    expect(parseSemver("1.2.3.4")).toBeUndefined();
    expect(parseSemver("1.x.0")).toBeUndefined();
    expect(parseSemver("-1.0.0")).toBeUndefined();
  });
});

describe("compareSemver", () => {
  it("orders versions correctly", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareSemver("1.1.0", "1.0.9")).toBeGreaterThan(0);
    expect(compareSemver("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
});

describe("meetsMinimum", () => {
  it("returns true when no minimum is set", () => {
    expect(meetsMinimum("0.1.0", "")).toBe(true);
  });

  it("enforces the minimum", () => {
    expect(meetsMinimum("1.2.0", "1.1.0")).toBe(true);
    expect(meetsMinimum("1.1.0", "1.1.0")).toBe(true);
    expect(meetsMinimum("1.0.9", "1.1.0")).toBe(false);
  });
});
