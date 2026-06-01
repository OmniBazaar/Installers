/**
 * Renderer-side typing for the `window.serviceNode` bridge exposed by preload.
 * Mirrors `src/ipc.ts#ServiceNodeApi`; kept local because the renderer compiles
 * against the DOM lib without Node types.
 *
 * @module renderer/api
 */

/** Lifecycle status of the supervised service node. */
type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

/** A provisioning progress event. */
interface ProvisionEvent {
  phase: string;
  message: string;
  percent?: number;
}

/** Outcome of an update check. */
interface UpdateCheckResult {
  current: string;
  latest: string;
  updateAvailable: boolean;
}

/** Public preflight info. */
interface PreflightInfo {
  address: string;
}

/** The bridged API surface. */
interface ServiceNodeApi {
  translations(): Promise<Record<string, string>>;
  isOnboarded(): Promise<boolean>;
  preflight(username: string, password: string): Promise<PreflightInfo>;
  provision(): Promise<void>;
  complete(username: string, password: string): Promise<void>;
  status(): Promise<ServiceStatus>;
  start(): Promise<void>;
  stop(): Promise<void>;
  logs(): Promise<string[]>;
  checkUpdates(): Promise<UpdateCheckResult>;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<void>;
  openDashboard(): Promise<void>;
  onStatusChanged(handler: (status: ServiceStatus) => void): () => void;
  onLogLine(handler: (line: string) => void): () => void;
  onProvisionProgress(handler: (event: ProvisionEvent) => void): () => void;
}

interface Window {
  serviceNode: ServiceNodeApi;
}
