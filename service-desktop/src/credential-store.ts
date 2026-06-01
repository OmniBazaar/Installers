/**
 * Encrypted-at-rest store for the operator's OmniBazaar credentials. The
 * credentials are the only secret the launcher holds — the service node derives
 * the wallet from them itself, so a raw private key never reaches this layer.
 *
 * Encryption is delegated to an injected {@link Encryptor}; in production this
 * is Electron's OS-native `safeStorage` (DPAPI / Keychain / libsecret), which is
 * stronger than a password-derived file and requires no crypto reimplementation.
 * The store logic here is electron-free and unit-tested with a fake encryptor.
 *
 * @module credential-store
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";

/** Minimal symmetric encryptor contract (satisfied by Electron safeStorage). */
export interface Encryptor {
  /** @returns Whether OS-native encryption is available on this host. */
  isEncryptionAvailable(): boolean;
  /** Encrypt plaintext to ciphertext bytes. */
  encryptString(plainText: string): Buffer;
  /** Decrypt ciphertext bytes back to plaintext. */
  decryptString(cipher: Buffer): string;
}

/** Operator credentials persisted by the store. */
export interface StoredCredentials {
  /** Account username. */
  username: string;
  /** Account password. */
  password: string;
  /** Derived owner address (cached for display; not a secret). */
  address: string;
}

/** Encrypted-at-rest credential store backed by a single file. */
export class CredentialStore {
  /**
   * @param filePath - Absolute path to the encrypted credentials file.
   * @param encryptor - OS-native encryptor (Electron safeStorage in production).
   */
  constructor(
    private readonly filePath: string,
    private readonly encryptor: Encryptor,
  ) {}

  /** @returns Whether credentials have been saved. */
  hasCredentials(): boolean {
    return existsSync(this.filePath);
  }

  /**
   * Encrypt and persist credentials. Throws if OS-native encryption is
   * unavailable — we refuse to write secrets in plaintext.
   * @param credentials - The credentials to store.
   */
  save(credentials: StoredCredentials): void {
    if (!this.encryptor.isEncryptionAvailable()) {
      throw new Error(
        "OS-native encryption unavailable; refusing to store credentials in plaintext",
      );
    }
    const cipher = this.encryptor.encryptString(JSON.stringify(credentials));
    writeFileSync(this.filePath, cipher, { mode: 0o600 });
  }

  /**
   * Load and decrypt stored credentials.
   * @returns The credentials, or undefined when none are stored.
   */
  load(): StoredCredentials | undefined {
    if (!existsSync(this.filePath)) {
      return undefined;
    }
    const cipher = readFileSync(this.filePath);
    const json = this.encryptor.decryptString(cipher);
    return JSON.parse(json) as StoredCredentials;
  }

  /** Remove stored credentials (used on sign-out / reset). */
  clear(): void {
    rmSync(this.filePath, { force: true });
  }
}
