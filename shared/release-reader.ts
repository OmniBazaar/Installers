/**
 * Abstraction over the on-chain UpdateRegistry read surface, plus the default
 * ethers-backed implementation. The interface lets {@link verifyArtifact} be
 * unit-tested with an injected fake reader — mocking only the genuine chain
 * boundary, never the hashing or decision logic.
 *
 * @module shared/release-reader
 */
import { ethers } from "ethers";
import {
  MAINNET_CHAIN_ID,
  UPDATE_REGISTRY_READ_ABI,
  resolveRegistryAddress,
  resolveRpcUrl,
} from "./registry-config";

/** Normalised on-chain release record (the subset the verifier needs). */
export interface OnChainRelease {
  /** Semantic version string. */
  version: string;
  /** 0x-prefixed lowercase SHA-256 of the published artifact. */
  binaryHash: string;
  /** Minimum version nodes must run after this release. */
  minimumVersion: string;
  /** Whether this version has been revoked. */
  revoked: boolean;
  /** Revocation reason (empty when not revoked). */
  revokeReason: string;
}

/** Read-only view of UpdateRegistry used by the verifier. */
export interface ReleaseReader {
  /** Fetch the latest published release for a component. */
  getLatestRelease(component: string): Promise<OnChainRelease>;
  /** Fetch a specific published version for a component. */
  getRelease(component: string, version: string): Promise<OnChainRelease>;
  /** Fetch the minimum required version for a component (empty if none). */
  getMinimumVersion(component: string): Promise<string>;
}

/** Shape of the raw tuple returned by ethers for a `ReleaseInfo`. */
interface RawRelease {
  binaryHash: string;
  revoked: boolean;
  version: string;
  minimumVersion: string;
  revokeReason: string;
}

/**
 * Normalise an ethers result tuple into an {@link OnChainRelease}.
 * @param raw - The decoded contract tuple.
 * @returns The normalised, lower-cased release record.
 */
function normalise(raw: RawRelease): OnChainRelease {
  return {
    version: raw.version,
    binaryHash: raw.binaryHash.toLowerCase(),
    minimumVersion: raw.minimumVersion,
    revoked: raw.revoked,
    revokeReason: raw.revokeReason,
  };
}

/** Optional overrides for constructing an {@link EthersReleaseReader}. */
export interface EthersReleaseReaderOptions {
  /** Override RPC URL (default: `OMNICOIN_RPC_URL` env or mainnet). */
  rpcUrl?: string;
  /** Override registry address (default: env or mainnet). */
  registryAddress?: string;
  /** Override chain ID (default: mainnet 88008). */
  chainId?: number;
}

/** Default ethers-backed reader against the OmniCoin L1 UpdateRegistry. */
export class EthersReleaseReader implements ReleaseReader {
  private readonly contract: ethers.Contract;

  /**
   * @param options - Optional RPC / registry / chain-id overrides.
   */
  constructor(options: EthersReleaseReaderOptions = {}) {
    const chainId = options.chainId ?? MAINNET_CHAIN_ID;
    const provider = new ethers.JsonRpcProvider(
      resolveRpcUrl(options.rpcUrl),
      { chainId, name: `chain-${chainId}` },
      { staticNetwork: true },
    );
    this.contract = new ethers.Contract(
      resolveRegistryAddress(options.registryAddress),
      UPDATE_REGISTRY_READ_ABI,
      provider,
    );
  }

  /** @inheritdoc */
  async getLatestRelease(component: string): Promise<OnChainRelease> {
    const raw: RawRelease = await this.contract["getLatestRelease"](component);
    return normalise(raw);
  }

  /** @inheritdoc */
  async getRelease(component: string, version: string): Promise<OnChainRelease> {
    const raw: RawRelease = await this.contract["getRelease"](
      component,
      version,
    );
    return normalise(raw);
  }

  /** @inheritdoc */
  async getMinimumVersion(component: string): Promise<string> {
    const min: string = await this.contract["getMinimumVersion"](component);
    return min;
  }
}
