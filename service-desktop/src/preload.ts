/**
 * Preload script: exposes the typed {@link ServiceNodeApi} on `window.serviceNode`
 * over the context bridge. Context isolation is on and node integration is off in
 * the renderer, so this is the only channel between UI and main.
 *
 * @module preload
 */

import { contextBridge, ipcRenderer } from "electron";
import { EVENT, INVOKE, type ServiceNodeApi } from "./ipc";
import type { ServiceStatus } from "./child-supervisor";
import type { ProvisionEvent } from "./dep-provisioner/types";
import type { UpdateCheckResult } from "./updates";
import type { PreflightInfo } from "./ipc";

/**
 * Subscribe to a main→renderer event channel, returning an unsubscribe function.
 * @param channel - The event channel name.
 * @param handler - The payload handler.
 * @returns A function that removes the listener.
 */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: ServiceNodeApi = {
  translations: () =>
    ipcRenderer.invoke(INVOKE.translations) as Promise<Record<string, string>>,
  isOnboarded: () => ipcRenderer.invoke(INVOKE.isOnboarded) as Promise<boolean>,
  preflight: (username, password) =>
    ipcRenderer.invoke(INVOKE.preflight, username, password) as Promise<PreflightInfo>,
  provision: () => ipcRenderer.invoke(INVOKE.provision) as Promise<void>,
  complete: (username, password) =>
    ipcRenderer.invoke(INVOKE.complete, username, password) as Promise<void>,
  status: () => ipcRenderer.invoke(INVOKE.status) as Promise<ServiceStatus>,
  start: () => ipcRenderer.invoke(INVOKE.start) as Promise<void>,
  stop: () => ipcRenderer.invoke(INVOKE.stop) as Promise<void>,
  logs: () => ipcRenderer.invoke(INVOKE.logs) as Promise<string[]>,
  checkUpdates: () =>
    ipcRenderer.invoke(INVOKE.checkUpdates) as Promise<UpdateCheckResult>,
  getAutostart: () =>
    ipcRenderer.invoke(INVOKE.getAutostart) as Promise<boolean>,
  setAutostart: (enabled) =>
    ipcRenderer.invoke(INVOKE.setAutostart, enabled) as Promise<void>,
  openDashboard: () => ipcRenderer.invoke(INVOKE.openDashboard) as Promise<void>,
  onStatusChanged: (handler) =>
    subscribe<ServiceStatus>(EVENT.statusChanged, handler),
  onLogLine: (handler) => subscribe<string>(EVENT.logLine, handler),
  onProvisionProgress: (handler) =>
    subscribe<ProvisionEvent>(EVENT.provisionProgress, handler),
};

contextBridge.exposeInMainWorld("serviceNode", api);
