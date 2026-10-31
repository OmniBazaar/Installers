/**
 * Windows dependency provisioner. Service nodes need the production database
 * engine (so the YEDIS / distributed-lock code stays compatible), so on Windows
 * we provision a single-node YugabyteDB inside WSL2 rather than via Docker.
 *
 * The Windows path has four things to get right, and each one is checked rather
 * than assumed — a wrong answer here produces a node that installs cleanly and
 * then silently never starts again after a reboot:
 *   1. WSL2 is installed, the distribution we provision into exists, and it is
 *      running as **version 2** (WSL 1 has no systemd and no kernel of its own).
 *      `wsl --install` on Windows 10 can leave a distribution at version 1.
 *   2. systemd is enabled inside the distribution. `install-yugabyte.sh` skips
 *      its unit when `systemctl` is missing and says so only in a log line — the
 *      database then never comes back after the machine restarts.
 *   3. The WSL2 virtual machine does not take half of the host's memory with no
 *      cap (YugabyteDB then caps itself at 35 % of that half).
 *   4. The distribution's **user-level** YugabyteDB unit needs lingering, or it
 *      only starts when that user happens to log in.
 *
 * This path cannot run on the Linux build host; it is exercised on Windows with
 * the manual smoke steps documented in the README.
 *
 * @module dep-provisioner/windows-wsl2
 */

import { execFile } from "child_process";
import { existsSync, writeFileSync } from "fs";
import { totalmem } from "os";
import { join } from "path";
import type { DatabaseConfig } from "../config";
import { LOOPBACK_HOST } from "../config";
import { databaseConfigFromEnv, parseEnvFile } from "./index";
import type {
  ProvisionContext,
  ProvisionReporter,
  Provisioner,
} from "./types";

/** The WSL distribution we provision the database inside. */
const WSL_DISTRO = "Ubuntu";

/** Where `install-yugabyte.sh` writes its connection details, relative to `$HOME`. */
const YUGABYTE_ENV_RELATIVE = ".omnibazaar/config/yugabyte.env";

/** Lowest WSL memory cap we will write, in megabytes. */
const MIN_WSL_MEMORY_MB = 4096;

/** Highest WSL memory cap we will write, in megabytes. */
const MAX_WSL_MEMORY_MB = 8192;

/** Marker line identifying a `.wslconfig` this provisioner wrote. */
const WSLCONFIG_MARKER = "# Written by the OmniBazaar Service Node app";

/**
 * Runs an executable and resolves its standard output.
 * Injectable so the whole provisioner can be unit-tested without Windows.
 */
export type CommandRunner = (file: string, args: string[]) => Promise<string>;

/**
 * Default runner: `execFile`, rejecting with stderr when the command fails.
 * @param file - Executable.
 * @param args - Arguments.
 * @returns Standard output.
 */
const runCommand: CommandRunner = (file, args) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
        } else {
          resolve(stdout);
        }
      },
    );
  });

/**
 * Normalise output from `wsl.exe`.
 *
 * `wsl --list` writes UTF-16LE, and some builds keep the byte-order mark and the
 * interleaved NUL bytes even when the output is read as a string. Left as-is,
 * `Ubuntu` arrives as `U\0b\0u\0n\0t\0u\0` and never matches a distro name.
 *
 * @param raw - Raw stdout from `wsl.exe`.
 * @returns Plain ASCII text with the NUL bytes and byte-order mark removed.
 */
export function decodeWslOutput(raw: string): string {
  return raw.replace(/\0/g, "").replace(/^\uFEFF/, "");
}

/**
 * Parse the distribution names out of `wsl --list --quiet`.
 * @param raw - Raw stdout (any encoding).
 * @returns Distribution names, in the order `wsl` reported them.
 */
export function parseDistroList(raw: string): string[] {
  return decodeWslOutput(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * Parse `wsl --list --verbose` into a distribution→version map.
 *
 * The default distribution is prefixed with `*` and the columns are padded, so
 * the version is read as the last field of each row rather than by offset.
 *
 * @param raw - Raw stdout (any encoding).
 * @returns Map of distribution name to the version `wsl` reported (1 or 2).
 */
export function parseDistroVersions(raw: string): Map<string, 1 | 2> {
  const versions = new Map<string, 1 | 2>();
  for (const line of decodeWslOutput(raw).split(/\r?\n/)) {
    const fields = line.replace(/\*/g, " ").trim().split(/\s+/);
    if (fields.length < 3) {
      continue;
    }
    const version = fields[fields.length - 1];
    const name = fields[0] ?? "";
    if (name === "" || name.toUpperCase() === "NAME") {
      continue;
    }
    if (version === "1" || version === "2") {
      versions.set(name, version === "2" ? 2 : 1);
    }
  }
  return versions;
}

/**
 * Whether a `/etc/wsl.conf` body turns systemd on.
 *
 * Read with a regular expression rather than a parser because the file is a
 * small INI and an operator may have added unrelated sections (`[interop]`,
 * `[automount]`) around ours — those must survive.
 *
 * @param existing - Current `/etc/wsl.conf` contents, or `null` when absent.
 * @returns True when `[boot]` already declares `systemd=true`.
 */
export function hasSystemdBoot(existing: string | null): boolean {
  if (existing === null) {
    return false;
  }
  let inBoot = false;
  for (const line of existing.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inBoot = trimmed.toLowerCase() === "[boot]";
      continue;
    }
    if (inBoot && /^systemd\s*=\s*true$/i.test(trimmed)) {
      return true;
    }
  }
  return false;
}

/**
 * Produce a `/etc/wsl.conf` that enables systemd, preserving what is already there.
 * @param existing - Current contents, or `null` when the file does not exist.
 * @returns The full file body to write.
 */
export function systemdConfContent(existing: string | null): string {
  const body = (existing ?? "").replace(/\s*$/, "");
  const prefix = body === "" ? "" : `${body}\n`;
  return `${prefix}\n[boot]\nsystemd=true\n`;
}

/**
 * Choose a WSL2 memory cap for this host.
 *
 * WSL2 takes 50 % of host memory by default and YugabyteDB then caps itself at
 * 35 % of that, which on an 8 GB laptop leaves the database barely 1.4 GB.
 * Half the host, held between 4 GB and 8 GB, is enough for a single-node
 * database and leaves the rest to Windows.
 *
 * @param totalBytes - Total host memory in bytes (`os.totalmem()`).
 * @returns The cap in megabytes.
 */
export function wslMemoryCapMb(totalBytes: number): number {
  const half = Math.round(totalBytes / 1024 / 1024 / 2);
  return Math.min(MAX_WSL_MEMORY_MB, Math.max(MIN_WSL_MEMORY_MB, half));
}

/**
 * Build a `.wslconfig` body with a memory cap.
 * @param memoryMb - Cap in megabytes.
 * @returns The file body.
 */
export function wslConfigContent(memoryMb: number): string {
  return `${WSLCONFIG_MARKER}\n${WSLCONFIG_MARKER}\n[wsl2]\nmemory=${memoryMb}MB\n`;
}

/** Provisioner for Windows hosts (WSL2 + in-distro YugabyteDB). */
export class WindowsWsl2Provisioner implements Provisioner {
  /**
   * @param context - Runtime paths and host facts.
   * @param runner - Command runner; defaults to `execFile`.
   */
  constructor(
    private readonly context: ProvisionContext,
    private readonly runner: CommandRunner = runCommand,
  ) {}

  /** @inheritdoc */
  async provision(report: ProvisionReporter): Promise<DatabaseConfig> {
    report({
      phase: "checking",
      message: "Checking WSL2 availability",
      percent: 5,
    });
    await this.ensureDistro(report);

    report({
      phase: "checking",
      message: "Checking WSL2 version and systemd",
      percent: 20,
    });
    await this.ensureVersion2(report);
    await this.ensureSystemd(report);
    this.capWslMemory(report);

    report({
      phase: "installing-database",
      message: "Installing single-node YugabyteDB inside WSL2",
      percent: 40,
    });
    await this.runInWsl(
      `bash "$(wslpath '${this.context.scriptsDir}')/install-yugabyte.sh"`,
    );

    report({
      phase: "starting-database",
      message: "Reading database connection",
      percent: 80,
    });
    // The unit is a USER unit, so without lingering it only starts when that
    // user logs in — which on a machine left running is never.
    await this.enableLinger();
    const envText = await this.readYugabyteEnv();
    const dbConfig = databaseConfigFromEnv(parseEnvFile(envText));

    report({ phase: "done", message: "Dependencies ready", percent: 100 });
    // WSL2 forwards localhost, so the Windows-side host stays loopback.
    return { ...dbConfig, host: LOOPBACK_HOST };
  }

  /**
   * Make sure the distribution we provision into exists, installing WSL2 and the
   * distribution through one elevated PowerShell (one administrator prompt) when
   * it does not.
   *
   * @param report - Progress reporter.
   */
  private async ensureDistro(report: ProvisionReporter): Promise<void> {
    const distros = await this.listDistros();
    if (distros.includes(WSL_DISTRO)) {
      return;
    }
    report({
      phase: "checking",
      message: "Enabling WSL2 and installing Ubuntu (one administrator prompt required)",
      percent: 10,
    });
    await this.enableWsl2();
    const afterInstall = await this.listDistros();
    if (!afterInstall.includes(WSL_DISTRO)) {
      throw new Error(
        `WSL2 is installed but the "${WSL_DISTRO}" distribution is not. Install it ` +
          "from the Microsoft Store (search for Ubuntu), then retry.",
      );
    }
  }

  /**
   * Upgrade the distribution to WSL version 2 when it is running as version 1.
   *
   * `wsl --install` on Windows 10 can leave a distribution at version 1, where
   * systemd is unavailable and the database's kernel requirements are not met.
   *
   * @param report - Progress reporter.
   */
  private async ensureVersion2(report: ProvisionReporter): Promise<void> {
    const versions = await this.listDistroVersions();
    const version = versions.get(WSL_DISTRO);
    if (version === 2) {
      return;
    }
    if (version === undefined) {
      // `wsl --list --verbose` cannot answer before the distribution has run
      // once; provisioning continues and the systemd check reports the outcome.
      report({
        phase: "checking",
        message:
          "Could not read the WSL version of Ubuntu. If the node does not start " +
          "after a restart, run: wsl --set-version Ubuntu 2",
        percent: 22,
      });
      return;
    }
    report({
      phase: "checking",
      message: "Upgrading Ubuntu from WSL 1 to WSL 2 (this can take a few minutes)",
      percent: 22,
    });
    await this.runElevated(["--set-version", WSL_DISTRO, "2"]);
    const after = (await this.listDistroVersions()).get(WSL_DISTRO);
    if (after !== 2) {
      throw new Error(
        `Ubuntu is still running as WSL version ${String(after ?? "unknown")}. ` +
          "WSL 2 needs hardware virtualization (Intel VT-x / AMD-V) enabled in " +
          "the BIOS/UEFI. Enable it, then run: wsl --set-version Ubuntu 2",
      );
    }
  }

  /**
   * Turn on systemd inside the distribution, then verify it actually became PID 1.
   *
   * A failure here is reported, not thrown: the node still runs, but nothing
   * restarts the database after a reboot, and the operator needs to know that.
   *
   * @param report - Progress reporter.
   */
  private async ensureSystemd(report: ProvisionReporter): Promise<void> {
    const existing = await this.readWslConf();
    if (!hasSystemdBoot(existing)) {
      report({
        phase: "checking",
        message: "Enabling systemd inside Ubuntu",
        percent: 28,
      });
      const body = systemdConfContent(existing);
      await this.runInWslAsRoot(
        `printf '%s' ${this.shellQuote(body)} > /etc/wsl.conf`,
      );
      // `/etc/wsl.conf` is only read when the distribution starts.
      await this.restartWsl();
    }
    const pidOne = (await this.runInWsl("ps -p 1 -o comm=")).trim();
    if (!pidOne.includes("systemd")) {
      report({
        phase: "checking",
        message:
          "systemd is not running inside Ubuntu, so the database will not restart " +
          "by itself after a reboot. Update WSL (wsl --update) and set " +
          "[boot] systemd=true in /etc/wsl.conf to fix this.",
        percent: 30,
      });
      return;
    }
    report({
      phase: "checking",
      message: "systemd is running inside Ubuntu",
      percent: 30,
    });
  }

  /**
   * Write a memory cap for the WSL2 virtual machine, when the operator has not
   * already written one.
   *
   * Never overwrites an existing `.wslconfig`: it is a machine-wide file that may
   * already carry the operator's own networking or kernel settings.
   *
   * @param report - Progress reporter.
   */
  private capWslMemory(report: ProvisionReporter): void {
    const profile = process.env["USERPROFILE"];
    if (profile === undefined || profile === "") {
      return;
    }
    const configPath = join(profile, ".wslconfig");
    if (existsSync(configPath)) {
      return;
    }
    const memoryMb = wslMemoryCapMb(totalmem());
    try {
      writeFileSync(configPath, wslConfigContent(memoryMb), "utf8");
      report({
        phase: "checking",
        message: `Capped WSL memory at ${String(memoryMb)} MB in ${configPath}`,
        percent: 32,
      });
    } catch {
      // A cap we could not write is not a reason to fail the install; the
      // database runs, just with less headroom than we would prefer.
    }
  }

  /**
   * Enable lingering for the default distribution user so the user-level
   * YugabyteDB unit starts at boot instead of at that user's next login.
   */
  private async enableLinger(): Promise<void> {
    try {
      // The distribution's normal user is the first account in the 1000 block
      // (Ubuntu creates exactly one); root needs no lingering.
      await this.runInWslAsRoot(
        'user="$(getent passwd 1000 | cut -d: -f1)"; ' +
          '[ -n "$user" ] && loginctl enable-linger "$user"',
      );
    } catch {
      // Best effort: on a distribution without lingering support the database
      // still runs, it just needs a login after each boot.
    }
  }

  /**
   * Read the database connection file, falling back to root's home when the
   * installer ran as root.
   * @returns The `yugabyte.env` body.
   */
  private async readYugabyteEnv(): Promise<string> {
    try {
      return await this.runInWsl(`cat ~/${YUGABYTE_ENV_RELATIVE}`);
    } catch (err) {
      try {
        return await this.runInWslAsRoot(`cat ~/${YUGABYTE_ENV_RELATIVE}`);
      } catch {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Could not read ~/${YUGABYTE_ENV_RELATIVE} from the ${WSL_DISTRO} ` +
            `distribution: ${message}`,
        );
      }
    }
  }

  /**
   * Read `/etc/wsl.conf`, or `null` when it does not exist.
   * @returns The file body, or `null`.
   */
  private async readWslConf(): Promise<string | null> {
    try {
      return await this.runInWslAsRoot("cat /etc/wsl.conf");
    } catch {
      return null;
    }
  }

  /**
   * Restart WSL so `/etc/wsl.conf` takes effect.
   * @returns Resolves when WSL has shut down.
   */
  private async restartWsl(): Promise<void> {
    try {
      await this.runner("wsl", ["--shutdown"]);
    } catch {
      // `--shutdown` reports non-zero when no distribution is running.
    }
  }

  /** @returns Distribution names reported by `wsl --list --quiet`. */
  private async listDistros(): Promise<string[]> {
    try {
      return parseDistroList(await this.runner("wsl", ["--list", "--quiet"]));
    } catch {
      return [];
    }
  }

  /** @returns Distribution→version map reported by `wsl --list --verbose`. */
  private async listDistroVersions(): Promise<Map<string, 1 | 2>> {
    try {
      return parseDistroVersions(await this.runner("wsl", ["--list", "--verbose"]));
    } catch {
      return new Map<string, 1 | 2>();
    }
  }

  /**
   * Enable WSL2 + the virtual-machine platform and install the distribution via a
   * single elevated PowerShell. Throws a clear error when virtualization is
   * disabled.
   */
  private async enableWsl2(): Promise<void> {
    // `wsl --install` enables both required Windows features and installs the
    // default distribution; running it elevated yields one UAC prompt.
    try {
      await this.runElevated(["--install", "-d", WSL_DISTRO]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/virtual|hyper-v|0x80370102/i.test(message)) {
        throw new Error(
          "Hardware virtualization appears disabled. Enable Intel VT-x / AMD-V in your BIOS/UEFI, then retry.",
        );
      }
      throw new Error(`Failed to enable WSL2: ${message}`);
    }
  }

  /**
   * Run `wsl.exe` elevated through PowerShell, waiting for it to finish.
   * @param args - Arguments for `wsl.exe`.
   */
  private runElevated(args: string[]): Promise<string> {
    const argumentList = args.map((arg) => `'${arg}'`).join(",");
    const command = `Start-Process wsl -ArgumentList ${argumentList} -Verb RunAs -Wait`;
    return this.runner("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);
  }

  /**
   * Run a shell command inside the distribution as its default user.
   * @param command - The command to run under `bash -lc`.
   * @returns The command's stdout.
   */
  private runInWsl(command: string): Promise<string> {
    return this.runner("wsl", ["-d", WSL_DISTRO, "bash", "-lc", command]);
  }

  /**
   * Run a shell command inside the distribution as root.
   * @param command - The command to run under `bash -lc`.
   * @returns The command's stdout.
   */
  private runInWslAsRoot(command: string): Promise<string> {
    return this.runner("wsl", [
      "-d",
      WSL_DISTRO,
      "-u",
      "root",
      "bash",
      "-lc",
      command,
    ]);
  }

  /**
   * Quote a string for a POSIX shell single-quoted argument.
   * @param value - Raw text.
   * @returns The quoted form.
   */
  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
  }
}
