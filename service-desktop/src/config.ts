/**
 * Static configuration and the pure child-environment builder for the supervised
 * service-node process. Mirrors the env contract of the production gateway unit
 * (`Validator/systemd/omnicoin-validator-1.service`) and the Phase-1 gateway
 * installer, specialised to a localhost-only service node:
 *   NODE_TYPE=service, PORT=3001, UNIFIED_PORT=true, SERVICE_MIN_* thresholds,
 *   credentials passed as STAKING_USERNAME/STAKING_PASSWORD (the entry point
 *   derives the wallet itself via KeyDerivationService — the launcher never
 *   handles a private key).
 *
 * `buildServiceNodeEnv` is intentionally electron-free so it can be unit-tested.
 *
 * @module config
 */

/** The single HTTP+WS port the service node serves (dashboard + API + WS). */
export const SERVICE_HTTP_PORT = 3001;

/** WebSocket port advertised to the entry point (upgrades share the HTTP socket). */
export const SERVICE_WS_PORT = 8101;

/** Service-node intra-mesh P2P port (15001 range, distinct from gateway 14001). */
export const SERVICE_P2P_PORT = 15001;

/** Loopback host — the desktop service node binds only the operator's machine. */
export const LOOPBACK_HOST = "127.0.0.1";

/** Component identifier used against the on-chain UpdateRegistry. */
export const SERVICE_COMPONENT = "service-node";

/** Dashboard URL opened from the tray. */
export const DASHBOARD_URL = `http://${LOOPBACK_HOST}:${SERVICE_HTTP_PORT}`;

/** Default service-node qualification thresholds (participation ≥25, no AVAX). */
export const SERVICE_THRESHOLD_DEFAULTS = {
  /** Minimum participation score; SERVICE_THRESHOLDS default in AuthenticationService. */
  participation: "25",
  /** Service nodes require no XOM stake. */
  staking: "0",
  /** Service nodes require no KYC tier. */
  kyc: "0",
  /** Service nodes run no avalanchego, so require no AVAX balance. */
  avax: "0",
} as const;

/** Service-node threshold override map (string values, all optional). */
export type ServiceThresholds = Record<
  keyof typeof SERVICE_THRESHOLD_DEFAULTS,
  string
>;

/** Local database connection the bundled single-node YugabyteDB exposes. */
export interface DatabaseConfig {
  /** Host (always loopback for the desktop single-node DB). */
  readonly host: string;
  /** Port (YugabyteDB YSQL default 5433). */
  readonly port: number;
  /** Database user. */
  readonly user: string;
  /** Database password (generated locally at provision time). */
  readonly password: string;
}

/** Operator inputs needed to launch the service node. */
export interface ServiceNodeLaunchConfig {
  /** Stable node identifier, e.g. "service-node-1". */
  readonly nodeId: string;
  /** OmniBazaar account username (used for in-node wallet derivation). */
  readonly username: string;
  /** OmniBazaar account password (used for in-node wallet derivation). */
  readonly password: string;
  /** Local database connection parameters. */
  readonly database: DatabaseConfig;
  /** Optional threshold overrides; defaults to {@link SERVICE_THRESHOLD_DEFAULTS}. */
  readonly thresholds?: Partial<ServiceThresholds>;
}

/**
 * Build the environment for the supervised `service-node.js` child process.
 *
 * Pure: depends only on its arguments and the static constants above. The
 * returned record is merged over the inherited process env by the supervisor.
 *
 * @param config - Operator inputs and local database connection.
 * @returns A string→string env map for the child process.
 */
export function buildServiceNodeEnv(
  config: ServiceNodeLaunchConfig,
): Record<string, string> {
  const thresholds = {
    ...SERVICE_THRESHOLD_DEFAULTS,
    ...(config.thresholds ?? {}),
  };

  return {
    // The supervisor spawns this child with `process.execPath`, which in a
    // packaged app is the Electron binary, not `node`. Without this flag that
    // would launch a second Electron GUI instead of running service-node.js.
    // service-node.js is a pure Node program (no Electron APIs), so running it
    // as Node is correct; when nodePath is a real `node` (dev), the flag is a
    // harmless no-op.
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    NODE_TYPE: "service",
    NODE_ID: config.nodeId,
    HTTP_HOST: LOOPBACK_HOST,
    PORT: String(SERVICE_HTTP_PORT),
    WS_PORT: String(SERVICE_WS_PORT),
    P2P_PORT: String(SERVICE_P2P_PORT),
    UNIFIED_PORT: "true",
    AVALANCHE_NETWORK: "mainnet",
    YUGABYTE_HOST: config.database.host,
    YUGABYTE_PORT: String(config.database.port),
    DB_HOST: config.database.host,
    DB_PORT: String(config.database.port),
    DB_USER: config.database.user,
    DB_PASSWORD: config.database.password,
    IPFS_HOST: LOOPBACK_HOST,
    IPFS_API_PORT: "5001",
    // Wallet derivation happens inside the entry point from these credentials;
    // the launcher never sees the derived private key.
    STAKING_USERNAME: config.username,
    STAKING_PASSWORD: config.password,
    // Qualification is enforced at runtime by AuthenticationService. No
    // SKIP_VALIDATOR_AUTH — external nodes must meet the real thresholds.
    SERVICE_MIN_PARTICIPATION: thresholds.participation,
    SERVICE_MIN_STAKING: thresholds.staking,
    SERVICE_MIN_KYC: thresholds.kyc,
    SERVICE_MIN_AVAX: thresholds.avax,
  };
}
