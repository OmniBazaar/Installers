/**
 * System-tray UI. Builds the tray menu from the pure {@link statusPresentation}
 * machine and resolves all labels through i18next, so every operator-facing
 * string is localised. The menu offers start/stop, dashboard, logs, update
 * check, autostart toggle, and quit.
 *
 * @module tray
 */

import { Menu, Tray, nativeImage, type NativeImage } from "electron";
import type { i18n as I18nInstance } from "i18next";
import type { ServiceStatus } from "./child-supervisor";
import { primaryActionIsStart, statusPresentation } from "./tray-state";

/** Callbacks the tray invokes for menu actions. */
export interface TrayCallbacks {
  /** @returns The current service status. */
  getStatus(): ServiceStatus;
  /** Start the node. */
  onStart(): void;
  /** Stop the node. */
  onStop(): void;
  /** Open the dashboard. */
  onOpenDashboard(): void;
  /** Show the logs window. */
  onShowLogs(): void;
  /** Trigger an update check. */
  onCheckUpdates(): void;
  /** @returns Whether autostart is enabled. */
  getAutostart(): boolean;
  /** Toggle autostart on login. */
  onSetAutostart(enabled: boolean): void;
  /** Quit the application. */
  onQuit(): void;
}

/** A 1×1 transparent PNG, resized to a tray-sized template image. */
const PLACEHOLDER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQAG3pgkAAAAAElFTkSuQmCC";

/**
 * Build a tray icon. Ships a neutral template image; production packaging can
 * replace it with a branded asset without code changes.
 * @returns A tray-sized {@link NativeImage}.
 */
function trayIcon(): NativeImage {
  return nativeImage
    .createFromBuffer(Buffer.from(PLACEHOLDER_PNG, "base64"))
    .resize({ width: 16, height: 16 });
}

/** Controller returned by {@link createTray}. */
export interface TrayController {
  /** Rebuild the menu to reflect a new status. */
  refresh(): void;
  /** Tear down the tray. */
  destroy(): void;
}

/**
 * Create the system tray and wire its menu to the provided callbacks.
 * @param i18n - Initialised i18next instance for label resolution.
 * @param callbacks - Action callbacks.
 * @returns A {@link TrayController}.
 */
export function createTray(
  i18n: I18nInstance,
  callbacks: TrayCallbacks,
): TrayController {
  const tray = new Tray(trayIcon());
  const t = i18n.t.bind(i18n);

  const refresh = (): void => {
    const status = callbacks.getStatus();
    const presentation = statusPresentation(status);
    const statusLabel = `${presentation.indicator} ${t(presentation.labelKey)}`;
    const startStop = primaryActionIsStart(status)
      ? { label: t("tray.action.start"), click: callbacks.onStart }
      : { label: t("tray.action.stop"), click: callbacks.onStop };

    const menu = Menu.buildFromTemplate([
      { label: t("tray.title"), enabled: false },
      { type: "separator" },
      { label: statusLabel, enabled: false },
      { type: "separator" },
      startStop,
      { label: t("tray.action.dashboard"), click: callbacks.onOpenDashboard },
      { label: t("tray.action.logs"), click: callbacks.onShowLogs },
      { label: t("tray.action.checkUpdates"), click: callbacks.onCheckUpdates },
      {
        label: t("tray.action.autostart"),
        type: "checkbox",
        checked: callbacks.getAutostart(),
        click: (item) => callbacks.onSetAutostart(item.checked),
      },
      { type: "separator" },
      { label: t("tray.action.quit"), click: callbacks.onQuit },
    ]);

    tray.setContextMenu(menu);
    tray.setToolTip(statusLabel);
  };

  refresh();
  return {
    refresh,
    destroy: () => tray.destroy(),
  };
}
