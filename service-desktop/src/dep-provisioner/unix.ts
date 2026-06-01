/**
 * Linux/macOS dependency provisioner. Delegates database setup to the existing
 * `install-yugabyte.sh` (single-node YugabyteDB, native, x86_64 + aarch64),
 * reads back the connection it wrote to `~/.omnibazaar/config/yugabyte.env`, and
 * checks for an IPFS/Kubo binary the service node uses for storage.
 *
 * @module dep-provisioner/unix
 */

import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { DatabaseConfig } from "../config";
import { databaseConfigFromEnv, parseEnvFile } from "./index";
import type {
  ProvisionContext,
  ProvisionReporter,
  Provisioner,
} from "./types";

/** Provisioner for Linux and macOS hosts. */
export class UnixProvisioner implements Provisioner {
  /**
   * @param context - Runtime paths and host facts.
   */
  constructor(private readonly context: ProvisionContext) {}

  /** @inheritdoc */
  async provision(report: ProvisionReporter): Promise<DatabaseConfig> {
    report({
      phase: "checking",
      message: "Checking system prerequisites",
      percent: 5,
    });

    report({
      phase: "installing-database",
      message: "Installing single-node YugabyteDB",
      percent: 20,
    });
    await this.runScript("install-yugabyte.sh", report);

    report({
      phase: "starting-database",
      message: "Reading database connection",
      percent: 75,
    });
    const env = this.readYugabyteEnv();
    const dbConfig = databaseConfigFromEnv(env);

    report({
      phase: "installing-ipfs",
      message: "Checking IPFS storage backend",
      percent: 90,
    });
    this.checkIpfs(report);

    report({ phase: "done", message: "Dependencies ready", percent: 100 });
    return dbConfig;
  }

  /**
   * Run a staged shell script, streaming its output as progress log lines.
   * @param scriptName - File name within the staged scripts directory.
   * @param report - Progress reporter.
   */
  private runScript(
    scriptName: string,
    report: ProvisionReporter,
  ): Promise<void> {
    const scriptPath = join(this.context.scriptsDir, scriptName);
    if (!existsSync(scriptPath)) {
      return Promise.reject(
        new Error(`Provisioning script not found: ${scriptPath}`),
      );
    }
    return new Promise<void>((resolve, reject) => {
      const proc = spawn("bash", [scriptPath], {
        cwd: this.context.scriptsDir,
      });
      const onData = (chunk: Buffer): void => {
        report({
          phase: "installing-database",
          message: chunk.toString().trimEnd(),
        });
      };
      proc.stdout.on("data", onData);
      proc.stderr.on("data", onData);
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${scriptName} exited with code ${code ?? "?"}`));
        }
      });
    });
  }

  /** Read and parse the env file the Yugabyte installer wrote. */
  private readYugabyteEnv(): Map<string, string> {
    const envPath = join(this.context.configDir, "yugabyte.env");
    if (!existsSync(envPath)) {
      throw new Error(`Expected Yugabyte env at ${envPath} after install`);
    }
    return parseEnvFile(readFileSync(envPath, "utf8"));
  }

  /**
   * Report whether an IPFS binary is present. Non-fatal: the service node can
   * fall back to a remote IPFS gateway; a bundled Kubo install is a follow-up.
   * @param report - Progress reporter.
   */
  private checkIpfs(report: ProvisionReporter): void {
    const onPath = (process.env.PATH ?? "")
      .split(":")
      .some((dir) => dir !== "" && existsSync(join(dir, "ipfs")));
    report({
      phase: "installing-ipfs",
      message: onPath
        ? "IPFS binary detected"
        : "IPFS not found — service node will use a remote gateway",
    });
  }
}
