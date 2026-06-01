/**
 * Shared types for the per-OS dependency provisioner. Provisioners install the
 * runtime prerequisites a service node needs (single-node YugabyteDB, IPFS) and
 * report the resulting local database connection.
 *
 * @module dep-provisioner/types
 */

import type { DatabaseConfig } from "../config";

/** Coarse progress phases surfaced to the onboarding UI. */
export type ProvisionPhase =
  | "checking"
  | "installing-database"
  | "starting-database"
  | "installing-ipfs"
  | "done"
  | "error";

/** A single progress event emitted during provisioning. */
export interface ProvisionEvent {
  /** Current phase. */
  phase: ProvisionPhase;
  /** Human-readable, already-localised or key-based message. */
  message: string;
  /** 0–100 coarse progress for a determinate bar, when known. */
  percent?: number;
}

/** Callback the provisioner invokes for each progress event. */
export type ProvisionReporter = (event: ProvisionEvent) => void;

/** Runtime paths and host facts a provisioner needs. */
export interface ProvisionContext {
  /** Absolute path to the staged Validator `scripts/` directory. */
  scriptsDir: string;
  /** Absolute path to `~/.omnibazaar/config` where script env files land. */
  configDir: string;
  /** Node platform (`process.platform`). */
  platform: NodeJS.Platform;
}

/** A per-OS provisioner. */
export interface Provisioner {
  /**
   * Install and start the service node's runtime dependencies.
   * @param report - Progress reporter.
   * @returns The local database connection parameters.
   */
  provision(report: ProvisionReporter): Promise<DatabaseConfig>;
}
