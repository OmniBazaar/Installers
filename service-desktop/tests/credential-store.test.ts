import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CredentialStore, type Encryptor } from "../src/credential-store";

/** A fake encryptor that base64-encodes, standing in for OS safeStorage. */
function fakeEncryptor(available = true): Encryptor {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) =>
      Buffer.from(Buffer.from(plain, "utf8").toString("base64"), "utf8"),
    decryptString: (cipher) =>
      Buffer.from(cipher.toString("utf8"), "base64").toString("utf8"),
  };
}

describe("CredentialStore", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cred-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips encrypted credentials", () => {
    const store = new CredentialStore(join(dir, "c.enc"), fakeEncryptor());
    expect(store.hasCredentials()).toBe(false);
    store.save({ username: "alice", password: "secret", address: "0xabc" });
    expect(store.hasCredentials()).toBe(true);
    expect(store.load()).toEqual({
      username: "alice",
      password: "secret",
      address: "0xabc",
    });
  });

  it("refuses to write when encryption is unavailable", () => {
    const store = new CredentialStore(join(dir, "c.enc"), fakeEncryptor(false));
    expect(() =>
      store.save({ username: "a", password: "b", address: "0x" }),
    ).toThrow(/plaintext/);
  });

  it("clears stored credentials", () => {
    const store = new CredentialStore(join(dir, "c.enc"), fakeEncryptor());
    store.save({ username: "a", password: "b", address: "0x" });
    store.clear();
    expect(store.hasCredentials()).toBe(false);
    expect(store.load()).toBeUndefined();
  });
});
