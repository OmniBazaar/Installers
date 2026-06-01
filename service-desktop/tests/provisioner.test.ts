import {
  databaseConfigFromEnv,
  parseEnvFile,
  selectProvisioner,
} from "../src/dep-provisioner";
import { UnixProvisioner } from "../src/dep-provisioner/unix";
import { WindowsWsl2Provisioner } from "../src/dep-provisioner/windows-wsl2";
import type { ProvisionContext } from "../src/dep-provisioner/types";

/** Build a provision context for a given platform. */
function context(platform: NodeJS.Platform): ProvisionContext {
  return { scriptsDir: "/tmp/scripts", configDir: "/tmp/config", platform };
}

describe("selectProvisioner", () => {
  it("uses the Unix provisioner on linux and darwin", () => {
    expect(selectProvisioner(context("linux"))).toBeInstanceOf(UnixProvisioner);
    expect(selectProvisioner(context("darwin"))).toBeInstanceOf(
      UnixProvisioner,
    );
  });

  it("uses the WSL2 provisioner on win32", () => {
    expect(selectProvisioner(context("win32"))).toBeInstanceOf(
      WindowsWsl2Provisioner,
    );
  });

  it("throws for unsupported platforms", () => {
    expect(() => selectProvisioner(context("aix"))).toThrow(/Unsupported/);
  });
});

describe("parseEnvFile", () => {
  it("ignores comments and blank lines and strips quotes", () => {
    const env = parseEnvFile(
      "# comment\n\nDB_USER=omnibazaar_app\nDB_PASSWORD='secret'\nDB_PORT=5433\n",
    );
    expect(env.get("DB_USER")).toBe("omnibazaar_app");
    expect(env.get("DB_PASSWORD")).toBe("secret");
    expect(env.get("DB_PORT")).toBe("5433");
  });
});

describe("databaseConfigFromEnv", () => {
  it("forces loopback host and reads credentials", () => {
    const config = databaseConfigFromEnv(
      parseEnvFile("DB_HOST=localhost\nDB_USER=u\nDB_PASSWORD=p\nDB_PORT=5433"),
    );
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 5433,
      user: "u",
      password: "p",
    });
  });

  it("throws when credentials are missing", () => {
    expect(() => databaseConfigFromEnv(parseEnvFile("DB_PORT=5433"))).toThrow(
      /missing DB_USER/,
    );
  });
});
