import { restartBackoffMs } from "../src/child-supervisor";

describe("restartBackoffMs", () => {
  it("grows exponentially from 2s", () => {
    expect(restartBackoffMs(0)).toBe(2000);
    expect(restartBackoffMs(1)).toBe(4000);
    expect(restartBackoffMs(2)).toBe(8000);
    expect(restartBackoffMs(3)).toBe(16000);
  });

  it("caps at 60s", () => {
    expect(restartBackoffMs(5)).toBe(60000);
    expect(restartBackoffMs(20)).toBe(60000);
  });
});
