/**
 * Canonical on-chain UpdateRegistry coordinates for OmniCoin L1 mainnet.
 *
 * The source of truth for these values is
 * `Validator/src/config/omnicoin-integration.ts`. They are duplicated here so
 * the standalone installer/verifier tooling has zero dependency on the
 * Validator build (the verifier must run on a stranger's machine before any
 * Validator code is installed). Keep in sync with, as of this writing:
 *   - UpdateRegistry: omnicoin-integration.ts:370
 *   - chainId 88008:  omnicoin-integration.ts:324
 *   - rpcUrl:         omnicoin-integration.ts:320 / 606
 * if the registry is ever redeployed or the public RPC endpoint changes.
 *
 * @module shared/registry-config
 */

/** Public read RPC for OmniCoin L1 mainnet (nginx proxy → gateway :9650). */
export const MAINNET_RPC_URL = "https://rpc.omnicoin.net";

/** OmniCoin L1 mainnet chain ID. */
export const MAINNET_CHAIN_ID = 88008;

/** Deployed UpdateRegistry proxy on OmniCoin L1 mainnet. */
export const MAINNET_UPDATE_REGISTRY =
  "0xA5eb4BF4a46B3CfAaC684818f56fD8263f79031D";

/**
 * Minimal read ABI for the UpdateRegistry view functions the verifier calls.
 * Mirrors the read interface declared in `UpdateCheckService.ts`.
 */
export const UPDATE_REGISTRY_READ_ABI: string[] = [
  "function getLatestRelease(string component) view returns (tuple(uint256 publishedAt, bytes32 binaryHash, address publishedBy, bool revoked, string version, string minimumVersion, string revokeReason, string changelogCID))",
  "function getRelease(string component, string version) view returns (tuple(uint256 publishedAt, bytes32 binaryHash, address publishedBy, bool revoked, string version, string minimumVersion, string revokeReason, string changelogCID))",
  "function getMinimumVersion(string component) view returns (string)",
  "function getLatestVersion(string component) view returns (string)",
  "function isVersionRevoked(string component, string version) view returns (bool)",
];

/**
 * Resolve the RPC URL to use.
 * @param explicit - Explicit override (highest priority).
 * @returns `explicit` > `OMNICOIN_RPC_URL` env > mainnet default.
 */
export function resolveRpcUrl(explicit?: string): string {
  return explicit ?? process.env["OMNICOIN_RPC_URL"] ?? MAINNET_RPC_URL;
}

/**
 * Resolve the UpdateRegistry contract address to use.
 * @param explicit - Explicit override (highest priority).
 * @returns `explicit` > `OMNICOIN_UPDATE_REGISTRY` env > mainnet default.
 */
export function resolveRegistryAddress(explicit?: string): string {
  return (
    explicit ??
    process.env["OMNICOIN_UPDATE_REGISTRY"] ??
    MAINNET_UPDATE_REGISTRY
  );
}
