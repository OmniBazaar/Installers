/**
 * Non-secret launcher settings persisted as plain JSON (node id + provisioned
 * database connection). Secrets (credentials) live in the encrypted
 * {@link CredentialStore}; this file holds only what is safe in cleartext.
 * Electron-free for unit testing.
 *
 * @module settings
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type { DatabaseConfig } from "./config";

/** Persisted launcher settings. */
export interface LauncherSettings {
  /** Stable node identifier. */
  nodeId: string;
  /** Database connection captured at provision time. */
  database: DatabaseConfig;
}

/**
 * Load settings from disk.
 * @param filePath - Absolute path to the settings JSON.
 * @returns The settings, or undefined when absent.
 */
export function loadSettings(filePath: string): LauncherSettings | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as LauncherSettings;
}

/**
 * Persist settings to disk.
 * @param filePath - Absolute path to the settings JSON.
 * @param settings - The settings to write.
 */
export function saveSettings(
  filePath: string,
  settings: LauncherSettings,
): void {
  writeFileSync(filePath, JSON.stringify(settings, null, 2));
}
