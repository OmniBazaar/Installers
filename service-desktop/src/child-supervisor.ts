/**
 * Supervises the bundled `service-node.js` as a child process: spawn with the
 * service-node environment, poll the health endpoint to confirm readiness,
 * stop gracefully (SIGTERM with a kill-after timeout), and restart on unexpected
 * exit with bounded exponential backoff.
 *
 * The launcher never runs business logic itself; this is a process supervisor
 * around the unchanged Validator entry point (thin-client invariant).
 *
 * @module child-supervisor
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { get as httpGet } from "http";
import {
  buildServiceNodeEnv,
  LOOPBACK_HOST,
  SERVICE_HTTP_PORT,
  type ServiceNodeLaunchConfig,
} from "./config";

/** Lifecycle status of the supervised service node. */
export type ServiceStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

/** Options controlling supervisor timing and restart policy. */
export interface SupervisorOptions {
  /** Absolute path to the bundled `service-node.js` entry point. */
  readonly entryPath: string;
  /** Working directory for the child (the staged Validator bundle root). */
  readonly cwd: string;
  /** Absolute path to the `node` binary to execute the entry point. */
  readonly nodePath?: string;
  /** Milliseconds to wait for graceful SIGTERM before SIGKILL. Default 10000. */
  readonly stopTimeoutMs?: number;
  /** Milliseconds between health polls while starting. Default 2000. */
  readonly healthPollMs?: number;
  /** Max health polls before declaring an error. Default 30 (~60s). */
  readonly maxHealthPolls?: number;
  /** Max automatic restarts after crashes before giving up. Default 5. */
  readonly maxRestarts?: number;
}

/**
 * Compute the backoff delay (ms) before the Nth consecutive restart.
 * Exponential, capped at 60s: 2s, 4s, 8s, 16s, 32s, 60s, 60s…
 *
 * Pure — unit-tested without spawning a process.
 *
 * @param restartCount - Number of restarts already attempted (0-based).
 * @returns Delay in milliseconds.
 */
export function restartBackoffMs(restartCount: number): number {
  const base = 2000 * Math.pow(2, restartCount);
  return Math.min(base, 60000);
}

/**
 * Process supervisor for the service node. Emits `"status"` with the new
 * {@link ServiceStatus} and `"log"` with stdout/stderr lines.
 */
export class ServiceNodeSupervisor extends EventEmitter {
  private readonly options: Required<SupervisorOptions>;
  private child: ChildProcess | undefined;
  private status: ServiceStatus = "stopped";
  private restartCount = 0;
  private deliberateStop = false;
  private healthTimer: NodeJS.Timeout | undefined;
  private restartTimer: NodeJS.Timeout | undefined;

  /**
   * @param options - Supervisor configuration.
   */
  constructor(options: SupervisorOptions) {
    super();
    this.options = {
      nodePath: process.execPath,
      stopTimeoutMs: 10000,
      healthPollMs: 2000,
      maxHealthPolls: 30,
      maxRestarts: 5,
      ...options,
    };
  }

  /** @returns The current lifecycle status. */
  getStatus(): ServiceStatus {
    return this.status;
  }

  private setStatus(next: ServiceStatus): void {
    if (this.status !== next) {
      this.status = next;
      this.emit("status", next);
    }
  }

  /**
   * Start the service node with the operator's launch config. Idempotent: a
   * no-op if already starting or running.
   * @param config - Operator inputs and database connection.
   */
  start(config: ServiceNodeLaunchConfig): void {
    if (this.status === "starting" || this.status === "running") {
      return;
    }
    this.deliberateStop = false;
    this.setStatus("starting");

    const child = spawn(this.options.nodePath, [this.options.entryPath], {
      cwd: this.options.cwd,
      env: { ...process.env, ...buildServiceNodeEnv(config) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString());
    });

    child.on("exit", (code) => {
      this.child = undefined;
      this.clearHealthTimer();
      if (this.deliberateStop) {
        this.setStatus("stopped");
        return;
      }
      this.emit("log", `service-node exited unexpectedly (code ${code ?? "?"})`);
      this.scheduleRestart(config);
    });

    this.pollHealth(0);
  }

  private scheduleRestart(config: ServiceNodeLaunchConfig): void {
    if (this.restartCount >= this.options.maxRestarts) {
      this.emit(
        "log",
        `Giving up after ${this.restartCount} restarts; manual start required`,
      );
      this.setStatus("error");
      return;
    }
    const delay = restartBackoffMs(this.restartCount);
    this.restartCount += 1;
    this.setStatus("error");
    this.emit("log", `Restarting in ${Math.round(delay / 1000)}s…`);
    this.restartTimer = setTimeout(() => this.start(config), delay);
  }

  private pollHealth(attempt: number): void {
    if (attempt >= this.options.maxHealthPolls) {
      this.emit("log", "Health check timed out");
      this.setStatus("error");
      return;
    }
    this.healthTimer = setTimeout(() => {
      this.checkHealth((healthy) => {
        if (healthy) {
          this.restartCount = 0;
          this.setStatus("running");
        } else if (this.child !== undefined) {
          this.pollHealth(attempt + 1);
        }
      });
    }, this.options.healthPollMs);
  }

  private checkHealth(done: (healthy: boolean) => void): void {
    const req = httpGet(
      { host: LOOPBACK_HOST, port: SERVICE_HTTP_PORT, path: "/health" },
      (res) => {
        res.resume();
        done(res.statusCode === 200);
      },
    );
    req.on("error", () => done(false));
    req.setTimeout(1500, () => {
      req.destroy();
      done(false);
    });
  }

  /**
   * Stop the service node gracefully. Resolves once the child has exited or the
   * kill-after timeout has fired.
   * @returns A promise that resolves when stopped.
   */
  stop(): Promise<void> {
    this.deliberateStop = true;
    this.clearHealthTimer();
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const child = this.child;
    if (child === undefined) {
      this.setStatus("stopped");
      return Promise.resolve();
    }
    this.setStatus("stopping");
    return new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, this.options.stopTimeoutMs);
      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private clearHealthTimer(): void {
    if (this.healthTimer !== undefined) {
      clearTimeout(this.healthTimer);
      this.healthTimer = undefined;
    }
  }
}
