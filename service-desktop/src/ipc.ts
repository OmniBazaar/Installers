/**
 * The typed IPC contract between the renderer and the main process. Channel
 * names are centralised here so preload, main, and the renderer agree on a
 * single surface. The renderer mirrors the `ServiceNodeApi` shape in
 * `src/renderer/api.d.ts` (it compiles against the DOM lib separately).
 *
 * @module ipc
 */

import type { ServiceStatus } from "./child-supervisor";
import type { ProvisionEvent } from "./dep-provisioner/types";
import type { UpdateCheckResult } from "./updates";

/** Renderer→main invoke channels. */
export const INVOKE = {
  preflight: "onboarding:preflight",
  provision: "onboarding:provision",
  complete: "onboarding:complete",
  status: "node:status",
  start: "node:start",
  stop: "node:stop",
  logs: "node:logs",
  checkUpdates: "updates:check",
  getAutostart: "settings:getAutostart",
  setAutostart: "settings:setAutostart",
  openDashboard: "app:openDashboard",
  isOnboarded: "app:isOnboarded",
  translations: "app:translations",
} as const;

/** Main→renderer event channels. */
export const EVENT = {
  statusChanged: "status:changed",
  logLine: "log:line",
  provisionProgress: "provision:progress",
} as const;

/** Result of the credential preflight (public info only). */
export interface PreflightInfo {
  /** Derived owner address. */
  address: string;
}

/** The API exposed to the renderer over the context bridge. */
export interface ServiceNodeApi {
  /** The active locale's flat key→string dictionary for renderer localisation. */
  translations(): Promise<Record<string, string>>;
  /** Whether credentials are already stored (skip onboarding). */
  isOnboarded(): Promise<boolean>;
  /** Derive and return the operator's address from credentials. */
  preflight(username: string, password: string): Promise<PreflightInfo>;
  /** Provision OS dependencies; progress arrives via {@link onProvisionProgress}. */
  provision(): Promise<void>;
  /** Persist credentials and start the node. */
  complete(username: string, password: string): Promise<void>;
  /** Current lifecycle status. */
  status(): Promise<ServiceStatus>;
  /** Start the node. */
  start(): Promise<void>;
  /** Stop the node. */
  stop(): Promise<void>;
  /** Recent log lines. */
  logs(): Promise<string[]>;
  /** Check the on-chain registry for a newer release. */
  checkUpdates(): Promise<UpdateCheckResult>;
  /** Whether autostart-on-login is enabled. */
  getAutostart(): Promise<boolean>;
  /** Enable/disable autostart-on-login. */
  setAutostart(enabled: boolean): Promise<void>;
  /** Open the local dashboard in the default browser. */
  openDashboard(): Promise<void>;
  /** Subscribe to status changes. Returns an unsubscribe function. */
  onStatusChanged(handler: (status: ServiceStatus) => void): () => void;
  /** Subscribe to log lines. Returns an unsubscribe function. */
  onLogLine(handler: (line: string) => void): () => void;
  /** Subscribe to provisioning progress. Returns an unsubscribe function. */
  onProvisionProgress(handler: (event: ProvisionEvent) => void): () => void;
}
