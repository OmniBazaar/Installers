import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  databaseConfigFromEnv,
  parseEnvFile,
  selectProvisioner,
} from "../src/dep-provisioner";
import { UnixProvisioner } from "../src/dep-provisioner/unix";
import {
  WindowsWsl2Provisioner,
  decodeWslOutput,
  hasSystemdBoot,
  parseDistroList,
  parseDistroVersions,
  systemdConfContent,
  wslConfigContent,
  wslMemoryCapMb,
} from "../src/dep-provisioner/windows-wsl2";
import type { CommandRunner } from "../src/dep-provisioner/windows-wsl2";
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

describe("decodeWslOutput", () => {
  it("strips the NUL bytes of UTF-16 output", () => {
    expect(decodeWslOutput("U\0b\0u\0n\0t\0u\0\r\0\n\0")).toBe("Ubuntu\r\n");
  });

  it("strips a leading byte-order mark", () => {
    expect(decodeWslOutput("\uFEFFUbuntu")).toBe("Ubuntu");
  });
});

describe("parseDistroList", () => {
  it("reads names from clean output", () => {
    expect(parseDistroList("Ubuntu\r\ndocker-desktop\r\n")).toEqual([
      "Ubuntu",
      "docker-desktop",
    ]);
  });

  it("reads names from UTF-16 output with stray whitespace", () => {
    expect(parseDistroList("*\0 \0U\0b\0u\0n\0t\0u\0\r\0\n\0 \0\r\0\n\0")).toEqual([
      "* Ubuntu",
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseDistroList("")).toEqual([]);
  });
});

describe("parseDistroVersions", () => {
  const verbose = [
    "  NAME            STATE           VERSION",
    "* Ubuntu          Running         2",
    "  docker-desktop  Stopped         1",
    "",
  ].join("\r\n");

  it("maps each distribution to its version", () => {
    const versions = parseDistroVersions(verbose);
    expect(versions.get("Ubuntu")).toBe(2);
    expect(versions.get("docker-desktop")).toBe(1);
  });

  it("ignores the header row", () => {
    expect(parseDistroVersions(verbose).has("NAME")).toBe(false);
  });

  it("returns an empty map when the output is unreadable", () => {
    expect(parseDistroVersions("").size).toBe(0);
  });
});

describe("hasSystemdBoot", () => {
  it("is false when the file is absent", () => {
    expect(hasSystemdBoot(null)).toBe(false);
  });

  it("is true when [boot] declares systemd=true", () => {
    expect(hasSystemdBoot("[boot]\nsystemd=true\n")).toBe(true);
  });

  it("is false when systemd is explicitly disabled", () => {
    expect(hasSystemdBoot("[boot]\nsystemd=false\n")).toBe(false);
  });

  it("ignores systemd=true in another section", () => {
    expect(hasSystemdBoot("[interop]\nsystemd=true\n")).toBe(false);
  });
});

describe("systemdConfContent", () => {
  it("appends a boot section to an existing file", () => {
    const body = systemdConfContent("[interop]\nappendWindowsPath=false\n");
    expect(body).toContain("[interop]");
    expect(body).toContain("[boot]");
    expect(body).toContain("systemd=true");
  });

  it("creates the file body from nothing", () => {
    expect(systemdConfContent(null)).toBe("\n[boot]\nsystemd=true\n");
  });
});

describe("wslMemoryCapMb", () => {
  const gib = 1024 ** 3;

  it("takes half of an 8 GB host", () => {
    expect(wslMemoryCapMb(8 * gib)).toBe(4096);
  });

  it("never goes below 4 GB", () => {
    expect(wslMemoryCapMb(4 * gib)).toBe(4096);
  });

  it("never goes above 8 GB", () => {
    expect(wslMemoryCapMb(64 * gib)).toBe(8192);
  });
});

describe("wslConfigContent", () => {
  it("writes a memory cap and identifies itself", () => {
    const body = wslConfigContent(6144);
    expect(body).toContain("[wsl2]");
    expect(body).toContain("memory=6144MB");
    expect(body).toContain("OmniBazaar");
  });
});

describe("WindowsWsl2Provisioner", () => {
  /** A recorded `wsl`/`powershell` invocation. */
  interface Call {
    file: string;
    args: string[];
    command: string;
  }

  /** Canned host state used to build a fake runner. */
  interface FakeHost {
    /** Distributions reported by `wsl --list --quiet`. */
    distros: string[];
    /** Version rows reported by `wsl --list --verbose`. */
    versions: string;
    /** `/etc/wsl.conf` contents, or `null` when it does not exist. */
    wslConf: string | null;
    /** Output of `ps -p 1 -o comm=`. */
    pidOne: string;
  }

  const envFile = "DB_USER=omnibazaar_app\nDB_PASSWORD=pw\nDB_PORT=5433\n";

  /**
   * Build a fake runner over a mutable host, recording every call.
   * @param host - Host state to answer from.
   * @param calls - Array the calls are appended to.
   * @returns The runner.
   */
  function fakeRunner(host: FakeHost, calls: Call[]): CommandRunner {
    return (file, args) => {
      const command = args.join(" ");
      calls.push({ file, args, command });
      if (file === "powershell.exe") {
        return Promise.resolve("");
      }
      if (args.includes("--list")) {
        return args.includes("--verbose")
          ? Promise.resolve(host.versions)
          : Promise.resolve(host.distros.join("\r\n"));
      }
      if (args.includes("--shutdown")) {
        return Promise.resolve("");
      }
      if (command.includes("cat /etc/wsl.conf")) {
        return host.wslConf === null
          ? Promise.reject(new Error("cat: /etc/wsl.conf: No such file or directory"))
          : Promise.resolve(host.wslConf);
      }
      if (command.includes("ps -p 1")) {
        return Promise.resolve(`${host.pidOne}\n`);
      }
      if (command.includes("loginctl enable-linger")) {
        return Promise.resolve("");
      }
      return Promise.resolve(envFile);
    };
  }

  it("installs and returns a loopback connection when the host is ready", async () => {
    const calls: Call[] = [];
    const host: FakeHost = {
      distros: ["Ubuntu"],
      versions: "  NAME    STATE    VERSION\r\n* Ubuntu  Running  2\r\n",
      wslConf: "[boot]\nsystemd=true\n",
      pidOne: "systemd",
    };
    const provisioner = new WindowsWsl2Provisioner(
      context("win32"),
      fakeRunner(host, calls),
    );

    const config = await provisioner.provision(() => undefined);

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 5433,
      user: "omnibazaar_app",
      password: "pw",
    });
    // Nothing elevated: the distribution was already there and already WSL 2.
    expect(calls.filter((c) => c.file === "powershell.exe")).toHaveLength(0);
    expect(calls.some((c) => c.command.includes("install-yugabyte.sh"))).toBe(true);
  });

  it("installs the distribution when WSL has none", async () => {
    const calls: Call[] = [];
    const host: FakeHost = {
      distros: [],
      versions: "",
      wslConf: "[boot]\nsystemd=true\n",
      pidOne: "systemd",
    };
    let listed = 0;
    const runner: CommandRunner = (file, args) => {
      if (file === "wsl" && args.includes("--list") && !args.includes("--verbose")) {
        listed += 1;
        calls.push({ file, args, command: args.join(" ") });
        // First listing is empty, second (after the elevated install) is not.
        return Promise.resolve(listed === 1 ? "" : "Ubuntu\r\n");
      }
      return fakeRunner(host, calls)(file, args);
    };

    const provisioner = new WindowsWsl2Provisioner(context("win32"), runner);
    await provisioner.provision(() => undefined);

    expect(
      calls.some(
        (c) =>
          c.file === "powershell.exe" &&
          c.command.includes("--install") &&
          c.command.includes("Ubuntu"),
      ),
    ).toBe(true);
  });

  it("upgrades a version-1 distribution to WSL 2", async () => {
    const calls: Call[] = [];
    const host: FakeHost = {
      distros: ["Ubuntu"],
      versions: "  NAME    STATE    VERSION\r\n* Ubuntu  Running  1\r\n",
      wslConf: "[boot]\nsystemd=true\n",
      pidOne: "systemd",
    };
    const base = fakeRunner(host, calls);
    // `wsl --set-version` is what changes the answer, so the fake host reports
    // version 2 for every listing made after the elevated call.
    const runner: CommandRunner = (file, args) => {
      if (file === "powershell.exe") {
        host.versions = "  NAME    STATE    VERSION\r\n* Ubuntu  Running  2\r\n";
      }
      return base(file, args);
    };
    const provisioner = new WindowsWsl2Provisioner(context("win32"), runner);

    await provisioner.provision(() => undefined);

    expect(
      calls.some(
        (c) =>
          c.file === "powershell.exe" &&
          c.command.includes("--set-version") &&
          c.command.includes("2"),
      ),
    ).toBe(true);
  });

  it("writes systemd into /etc/wsl.conf and restarts WSL when it is missing", async () => {
    const calls: Call[] = [];
    const host: FakeHost = {
      distros: ["Ubuntu"],
      versions: "  NAME    STATE    VERSION\r\n* Ubuntu  Running  2\r\n",
      wslConf: "[interop]\nappendWindowsPath=false\n",
      pidOne: "systemd",
    };
    const provisioner = new WindowsWsl2Provisioner(
      context("win32"),
      fakeRunner(host, calls),
    );

    await provisioner.provision(() => undefined);

    const written = calls.find((c) =>
      c.command.includes("> /etc/wsl.conf"),
    );
    expect(written).toBeDefined();
    expect(written?.command).toContain("systemd=true");
    expect(written?.args).toContain("root");
    expect(calls.some((c) => c.command.includes("--shutdown"))).toBe(true);
  });

  it("still provisions when systemd never comes up, and says so", async () => {
    const calls: Call[] = [];
    const host: FakeHost = {
      distros: ["Ubuntu"],
      versions: "  NAME    STATE    VERSION\r\n* Ubuntu  Running  2\r\n",
      wslConf: "[boot]\nsystemd=true\n",
      pidOne: "init",
    };
    const messages: string[] = [];
    const provisioner = new WindowsWsl2Provisioner(
      context("win32"),
      fakeRunner(host, calls),
    );

    const config = await provisioner.provision((event) => {
      messages.push(event.message);
    });

    expect(config.host).toBe("127.0.0.1");
    expect(messages.some((m) => m.includes("will not restart"))).toBe(true);
  });

  it("throws a virtualization hint when WSL cannot start", async () => {
    const runner: CommandRunner = (file, args) => {
      if (file === "powershell.exe") {
        return Promise.reject(
          new Error("WslRegisterDistribution failed with error 0x80370102"),
        );
      }
      if (file === "wsl" && args.includes("--list")) {
        return Promise.reject(new Error("no distributions"));
      }
      return Promise.resolve("");
    };
    const provisioner = new WindowsWsl2Provisioner(context("win32"), runner);

    await expect(provisioner.provision(() => undefined)).rejects.toThrow(
      /virtualization/i,
    );
  });

  it("writes a .wslconfig memory cap only when none exists", async () => {
    const profile = mkdtempSync(join(tmpdir(), "wsl-profile-"));
    const previous = process.env["USERPROFILE"];
    process.env["USERPROFILE"] = profile;
    try {
      const host: FakeHost = {
        distros: ["Ubuntu"],
        versions: "  NAME    STATE    VERSION\r\n* Ubuntu  Running  2\r\n",
        wslConf: "[boot]\nsystemd=true\n",
        pidOne: "systemd",
      };
      const provisioner = new WindowsWsl2Provisioner(
        context("win32"),
        fakeRunner(host, []),
      );

      await provisioner.provision(() => undefined);
      const written = readFileSync(join(profile, ".wslconfig"), "utf8");
      expect(written).toContain("memory=");

      const second = new WindowsWsl2Provisioner(
        context("win32"),
        fakeRunner(host, []),
      );
      await second.provision(() => undefined);
      expect(readFileSync(join(profile, ".wslconfig"), "utf8")).toBe(written);
    } finally {
      if (previous === undefined) {
        delete process.env["USERPROFILE"];
      } else {
        process.env["USERPROFILE"] = previous;
      }
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
