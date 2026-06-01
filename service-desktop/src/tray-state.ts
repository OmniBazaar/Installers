/**
 * Pure presentation logic for the tray: maps a {@link ServiceStatus} to an
 * indicator glyph and the i18n key for its status label, and decides whether the
 * primary action is "start" or "stop". Electron-free so it is unit-tested in
 * isolation; `tray.ts` consumes it and resolves keys through i18next.
 *
 * @module tray-state
 */

import type { ServiceStatus } from "./child-supervisor";

/** A status's tray presentation: indicator glyph + label translation key. */
export interface StatusPresentation {
  /** Indicator glyph shown before the label. */
  indicator: string;
  /** i18next key for the human-readable status label. */
  labelKey: string;
}

/**
 * Map a service status to its tray presentation.
 * @param status - The current lifecycle status.
 * @returns The {@link StatusPresentation}.
 */
export function statusPresentation(status: ServiceStatus): StatusPresentation {
  switch (status) {
    case "running":
      return { indicator: "●", labelKey: "tray.status.running" };
    case "starting":
      return { indicator: "◐", labelKey: "tray.status.starting" };
    case "stopping":
      return { indicator: "◑", labelKey: "tray.status.stopping" };
    case "error":
      return { indicator: "⚠", labelKey: "tray.status.error" };
    case "stopped":
    default:
      return { indicator: "○", labelKey: "tray.status.stopped" };
  }
}

/**
 * Whether the primary toggle action should start (vs. stop) the node.
 * Start is offered only from terminal/idle states.
 * @param status - The current lifecycle status.
 * @returns True when the primary action is "start".
 */
export function primaryActionIsStart(status: ServiceStatus): boolean {
  return status === "stopped" || status === "error";
}
