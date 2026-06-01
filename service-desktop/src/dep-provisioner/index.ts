/**
 * Per-OS dependency-provisioner dispatch. `selectProvisioner` is a pure mapping
 * from platform to the concrete provisioner and is unit-tested; `parseEnvFile`
 * extracts the database connection the Yugabyte installer writes.
 *
 * @module dep-provisioner
 */

import type { DatabaseConfig } from "../config";
import { LOOPBACK_HOST } from "../config";
import type { ProvisionContext, Provisioner } from "./types";
import { UnixProvisioner } from "./unix";
import { WindowsWsl2Provisioner } from "./windows-wsl2";

/**
 * Select the provisioner for a platform. Throws for unsupported platforms so the
 * UI can show a clear "not supported" message rather than silently doing nothing.
 *
 * @param context - Runtime paths and host facts.
 * @returns The concrete {@link Provisioner}.
 */
export function selectProvisioner(context: ProvisionContext): Provisioner {
  switch (context.platform) {
    case "linux":
    case "darwin":
      return new UnixProvisioner(context);
    case "win32":
      return new WindowsWsl2Provisioner(context);
    default:
      throw new Error(`Unsupported platform: ${context.platform}`);
  }
}

/**
 * Parse a `KEY=VALUE` env file into a map. Ignores blank lines and `#` comments;
 * strips surrounding quotes. Pure and unit-tested.
 *
 * @param content - Raw env-file text.
 * @returns A key→value map.
 */
export function parseEnvFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    map.set(key, value);
  }
  return map;
}

/**
 * Build a {@link DatabaseConfig} from a parsed Yugabyte env map. Forces the host
 * to loopback (the desktop DB is local) and requires the user + password fields.
 *
 * @param env - Parsed env map from `yugabyte.env`.
 * @returns The database connection config.
 */
export function databaseConfigFromEnv(env: Map<string, string>): DatabaseConfig {
  const user = env.get("DB_USER");
  const password = env.get("DB_PASSWORD");
  if (user === undefined || password === undefined) {
    throw new Error("yugabyte.env missing DB_USER or DB_PASSWORD");
  }
  const parsedPort = Number(env.get("DB_PORT") ?? "5433");
  if (!Number.isFinite(parsedPort)) {
    throw new Error(`yugabyte.env has a non-numeric DB_PORT: ${env.get("DB_PORT") ?? ""}`);
  }
  const port = parsedPort;
  return { host: LOOPBACK_HOST, port, user, password };
}

export type { Provisioner, ProvisionContext, ProvisionReporter } from "./types";
