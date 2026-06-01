import { primaryActionIsStart, statusPresentation } from "../src/tray-state";

describe("statusPresentation", () => {
  it("maps each status to an indicator and label key", () => {
    expect(statusPresentation("running")).toEqual({
      indicator: "●",
      labelKey: "tray.status.running",
    });
    expect(statusPresentation("error").labelKey).toBe("tray.status.error");
    expect(statusPresentation("stopped").labelKey).toBe("tray.status.stopped");
  });
});

describe("primaryActionIsStart", () => {
  it("offers start only from idle/terminal states", () => {
    expect(primaryActionIsStart("stopped")).toBe(true);
    expect(primaryActionIsStart("error")).toBe(true);
    expect(primaryActionIsStart("running")).toBe(false);
    expect(primaryActionIsStart("starting")).toBe(false);
    expect(primaryActionIsStart("stopping")).toBe(false);
  });
});
