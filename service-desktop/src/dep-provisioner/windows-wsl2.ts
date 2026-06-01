/**
 * Windows dependency provisioner. Service nodes need the production database
 * engine (so the YEDIS / distributed-lock code stays compatible), so on Windows
 * we provision a single-node YugabyteDB inside WSL2 rather than via Docker. The
 * flow:
 *   1. Detect WSL2; if absent, enable it + the VM platform feature and install a
 *      distro through ONE elevated PowerShell (one UAC prompt). Fail loud when
 *      hardware virtualization is disabled in BIOS.
 *   2. Run the existing `install-yugabyte.sh` inside the distro.
 *   3. Read the connection it wrote; WSL2 forwards `localhost:5433` to Windows.
 *
 * This path cannot run on the Linux build host; it is exercised on Windows with
 * the manual smoke steps documented in the README.
 *
 * @module dep-provisioner/windows-wsl2
 */

import { execFile } from "child_process";
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

/** Provisioner for Windows hosts (WSL2 + in-distro YugabyteDB). */
export class WindowsWsl2Provisioner implements Provisioner {
  /**
   * @param context - Runtime paths and host facts.
   */
  constructor(private readonly context: ProvisionContext) {}

  /** @inheritdoc */
  async provision(report: ProvisionReporter): Promise<DatabaseConfig> {
    report({
      phase: "checking",
      message: "Checking WSL2 availability",
      percent: 5,
    });

    if (!(await this.isWsl2Ready())) {
      report({
        phase: "checking",
        message: "Enabling WSL2 (one administrator prompt required)",
        percent: 15,
      });
      await this.enableWsl2();
    }

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
    const envText = await this.runInWsl(
      "cat ~/.omnibazaar/config/yugabyte.env",
    );
    const dbConfig = databaseConfigFromEnv(parseEnvFile(envText));

    report({ phase: "done", message: "Dependencies ready", percent: 100 });
    // WSL2 forwards localhost, so the Windows-side host stays loopback.
    return { ...dbConfig, host: LOOPBACK_HOST };
  }

  /** @returns Whether a WSL2 distro is installed and ready. */
  private async isWsl2Ready(): Promise<boolean> {
    try {
      const out = await this.exec("wsl", ["--list", "--quiet"]);
      return out.split(/\r?\n/).some((line) => line.trim() !== "");
    } catch {
      return false;
    }
  }

  /**
   * Enable WSL2 + the virtual-machine platform and install a distro via a single
   * elevated PowerShell. Throws a clear error when virtualization is disabled.
   */
  private async enableWsl2(): Promise<void> {
    // `wsl --install` enables both required Windows features and installs the
    // default distro; running it elevated yields one UAC prompt.
    const command = `Start-Process wsl -ArgumentList '--install','-d','${WSL_DISTRO}' -Verb RunAs -Wait`;
    try {
      await this.exec("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        command,
      ]);
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
   * Run a shell command inside the WSL distro and return its stdout.
   * @param command - The command to run under `bash -lc`.
   * @returns The command's stdout.
   */
  private runInWsl(command: string): Promise<string> {
    return this.exec("wsl", ["-d", WSL_DISTRO, "bash", "-lc", command]);
  }

  /**
   * Promisified `execFile` returning stdout; rejects with stderr on non-zero.
   * @param file - Executable.
   * @param args - Arguments.
   * @returns stdout text.
   */
  private exec(file: string, args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
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
  }
}
