/**
 * Electron main process: orchestrates onboarding, dependency provisioning, the
 * supervised service-node child, the system tray, and the renderer windows. All
 * business logic stays in the bundled Validator entry point; this process is a
 * launcher and supervisor only.
 *
 * @module main
 */

import { app, BrowserWindow, ipcMain, safeStorage, shell, Notification } from "electron";
import { join } from "path";
import { mkdirSync } from "fs";
import type { i18n as I18nInstance } from "i18next";
import { CredentialStore, type Encryptor } from "./credential-store";
import { ServiceNodeSupervisor, type ServiceStatus } from "./child-supervisor";
import { selectProvisioner } from "./dep-provisioner";
import type { ProvisionEvent } from "./dep-provisioner/types";
import { initI18n, loadDictionary } from "./i18n";
import { EVENT, INVOKE, type PreflightInfo } from "./ipc";
import { resolvePaths, type ResolvedPaths } from "./paths";
import { runPreflight } from "./preflight";
import { loadSettings, saveSettings } from "./settings";
import { createTray, type TrayController } from "./tray";
import { checkForUpdate, type UpdateCheckResult } from "./updates";
import { SERVICE_COMPONENT, DASHBOARD_URL, type DatabaseConfig } from "./config";

/** Max log lines retained in memory for the logs view. */
const LOG_BUFFER_LIMIT = 1000;

/** Default node id for a fresh desktop service node. */
const DEFAULT_NODE_ID = "service-node-desktop";

/** Live process-wide singletons assembled in {@link bootstrap}. */
interface AppContext {
  paths: ResolvedPaths;
  i18n: I18nInstance;
  credentials: CredentialStore;
  supervisor: ServiceNodeSupervisor;
  settingsPath: string;
  logBuffer: string[];
  dictionary: Record<string, string>;
  tray: TrayController | undefined;
  window: BrowserWindow | undefined;
  database: DatabaseConfig | undefined;
}

let ctx: AppContext | undefined;

/** Electron's safeStorage adapted to the {@link Encryptor} contract. */
const safeStorageEncryptor: Encryptor = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (plain) => safeStorage.encryptString(plain),
  decryptString: (cipher) => safeStorage.decryptString(cipher),
};

/**
 * Send an event to the renderer if a window exists.
 * @param channel - The event channel.
 * @param payload - The event payload.
 */
function emitToRenderer(channel: string, payload: unknown): void {
  ctx?.window?.webContents.send(channel, payload);
}

/**
 * Create (or focus) the renderer window and load the appropriate view.
 * @param view - The HTML file to load (`onboarding.html` or `dashboard.html`).
 */
function showWindow(view: string): void {
  if (ctx === undefined) {
    return;
  }
  if (ctx.window !== undefined && !ctx.window.isDestroyed()) {
    ctx.window.show();
    ctx.window.focus();
    return;
  }
  const window = new BrowserWindow({
    width: 720,
    height: 560,
    show: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void window.loadFile(join(__dirname, "renderer", view));
  window.on("closed", () => {
    if (ctx !== undefined) {
      ctx.window = undefined;
    }
  });
  ctx.window = window;
}

/**
 * Build the launch config from stored credentials + settings and start the node.
 * @returns A promise that resolves once start has been requested.
 */
async function startNode(): Promise<void> {
  if (ctx === undefined) {
    return;
  }
  const creds = ctx.credentials.load();
  const settings = loadSettings(ctx.settingsPath);
  if (creds === undefined || settings === undefined) {
    throw new Error("Cannot start: node is not onboarded");
  }
  ctx.supervisor.start({
    nodeId: settings.nodeId,
    username: creds.username,
    password: creds.password,
    database: settings.database,
  });
}

/** Register all IPC handlers. */
function registerIpc(): void {
  ipcMain.handle(INVOKE.translations, (): Record<string, string> => {
    return ctx?.dictionary ?? {};
  });
  ipcMain.handle(INVOKE.isOnboarded, () => {
    return (
      ctx !== undefined &&
      ctx.credentials.hasCredentials() &&
      loadSettings(ctx.settingsPath) !== undefined
    );
  });

  ipcMain.handle(
    INVOKE.preflight,
    async (_e, username: string, password: string): Promise<PreflightInfo> => {
      if (ctx === undefined) {
        throw new Error("App not ready");
      }
      const result = await runPreflight({
        scriptPath: ctx.paths.preflightScript,
        nodePath: process.execPath,
        username,
        password,
        nodeType: "service",
      });
      return { address: result.address };
    },
  );

  ipcMain.handle(INVOKE.provision, async (): Promise<void> => {
    if (ctx === undefined) {
      throw new Error("App not ready");
    }
    const provisioner = selectProvisioner({
      scriptsDir: ctx.paths.scriptsDir,
      configDir: join(app.getPath("home"), ".omnibazaar", "config"),
      platform: process.platform,
    });
    const database = await provisioner.provision((event: ProvisionEvent) => {
      emitToRenderer(EVENT.provisionProgress, event);
    });
    ctx.database = database;
    saveSettings(ctx.settingsPath, { nodeId: DEFAULT_NODE_ID, database });
  });

  ipcMain.handle(
    INVOKE.complete,
    async (_e, username: string, password: string): Promise<void> => {
      if (ctx === undefined) {
        throw new Error("App not ready");
      }
      const info = await runPreflight({
        scriptPath: ctx.paths.preflightScript,
        nodePath: process.execPath,
        username,
        password,
        nodeType: "service",
      });
      ctx.credentials.save({ username, password, address: info.address });
      await startNode();
    },
  );

  ipcMain.handle(INVOKE.status, (): ServiceStatus => {
    return ctx?.supervisor.getStatus() ?? "stopped";
  });
  ipcMain.handle(INVOKE.start, () => startNode());
  ipcMain.handle(INVOKE.stop, () => ctx?.supervisor.stop());
  ipcMain.handle(INVOKE.logs, (): string[] => ctx?.logBuffer ?? []);

  ipcMain.handle(INVOKE.checkUpdates, async (): Promise<UpdateCheckResult> => {
    if (ctx === undefined) {
      throw new Error("App not ready");
    }
    return checkForUpdate({
      cliPath: ctx.paths.artifactCli,
      nodePath: process.execPath,
      nodeModulesPath: ctx.paths.validatorNodeModules,
      component: SERVICE_COMPONENT,
      currentVersion: app.getVersion(),
    });
  });

  ipcMain.handle(INVOKE.getAutostart, (): boolean => {
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle(INVOKE.setAutostart, (_e, enabled: boolean): void => {
    app.setLoginItemSettings({ openAtLogin: enabled });
  });
  ipcMain.handle(INVOKE.openDashboard, () => shell.openExternal(DASHBOARD_URL));
}

/**
 * Wire supervisor events to the tray, renderer, and log buffer.
 */
function wireSupervisor(): void {
  if (ctx === undefined) {
    return;
  }
  ctx.supervisor.on("status", (status: ServiceStatus) => {
    ctx?.tray?.refresh();
    emitToRenderer(EVENT.statusChanged, status);
  });
  ctx.supervisor.on("log", (line: string) => {
    if (ctx === undefined) {
      return;
    }
    ctx.logBuffer.push(line);
    if (ctx.logBuffer.length > LOG_BUFFER_LIMIT) {
      ctx.logBuffer.shift();
    }
    emitToRenderer(EVENT.logLine, line);
  });
}

/**
 * Build the tray with action callbacks bound to the live context.
 */
function buildTray(): void {
  if (ctx === undefined) {
    return;
  }
  ctx.tray = createTray(ctx.i18n, {
    getStatus: () => ctx?.supervisor.getStatus() ?? "stopped",
    onStart: () => {
      void startNode().catch((err: unknown) => notifyError(err));
    },
    onStop: () => {
      void ctx?.supervisor.stop();
    },
    onOpenDashboard: () => {
      void shell.openExternal(DASHBOARD_URL);
    },
    onShowLogs: () => showWindow("logs.html"),
    onCheckUpdates: () => {
      void runUpdateCheck();
    },
    getAutostart: () => app.getLoginItemSettings().openAtLogin,
    onSetAutostart: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
    onQuit: () => {
      void gracefulQuit();
    },
  });
}

/** Run an update check from the tray and notify the operator of the result. */
async function runUpdateCheck(): Promise<void> {
  if (ctx === undefined) {
    return;
  }
  try {
    const result = await checkForUpdate({
      cliPath: ctx.paths.artifactCli,
      nodePath: process.execPath,
      nodeModulesPath: ctx.paths.validatorNodeModules,
      component: SERVICE_COMPONENT,
      currentVersion: app.getVersion(),
    });
    const body = result.updateAvailable
      ? ctx.i18n.t("updates.available", { version: result.latest })
      : ctx.i18n.t("updates.upToDate");
    new Notification({ title: ctx.i18n.t("tray.title"), body }).show();
  } catch (err) {
    notifyError(err);
  }
}

/**
 * Surface an error to the operator as a desktop notification.
 * @param err - The error.
 */
function notifyError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (Notification.isSupported()) {
    new Notification({
      title: ctx?.i18n.t("error.title") ?? "Error",
      body: message,
    }).show();
  }
}

/** Stop the node gracefully and quit the app. */
async function gracefulQuit(): Promise<void> {
  await ctx?.supervisor.stop();
  ctx?.tray?.destroy();
  app.exit(0);
}

/** Assemble the {@link AppContext} and bring the app up. */
async function bootstrap(): Promise<void> {
  const userData = app.getPath("userData");
  mkdirSync(userData, { recursive: true });
  const paths = resolvePaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  const i18n = await initI18n(paths.localesDir, app.getLocale());
  const dictionary = loadDictionary(paths.localesDir, app.getLocale());

  ctx = {
    paths,
    i18n,
    dictionary,
    credentials: new CredentialStore(
      join(userData, "credentials.enc"),
      safeStorageEncryptor,
    ),
    supervisor: new ServiceNodeSupervisor({
      entryPath: paths.serviceNodeEntry,
      cwd: paths.validatorRoot,
    }),
    settingsPath: join(userData, "settings.json"),
    logBuffer: [],
    tray: undefined,
    window: undefined,
    database: undefined,
  };

  registerIpc();
  wireSupervisor();
  buildTray();

  const settings = loadSettings(ctx.settingsPath);
  const onboarded = ctx.credentials.hasCredentials() && settings !== undefined;
  if (onboarded) {
    await startNode().catch((err: unknown) => notifyError(err));
  } else {
    showWindow("onboarding.html");
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (ctx?.window !== undefined) {
      ctx.window.show();
      ctx.window.focus();
    }
  });
  // Keep running in the tray when all windows close.
  app.on("window-all-closed", () => undefined);
  app.on("before-quit", (event) => {
    if (ctx?.supervisor.getStatus() === "running") {
      event.preventDefault();
      void gracefulQuit();
    }
  });
  void app
    .whenReady()
    .then(bootstrap)
    .catch((err: unknown) => {
      // Fail loud: a bootstrap fault leaves the launcher unusable, so surface
      // it and exit non-zero rather than lingering as a dead tray icon.
      process.stderr.write(
        `Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
      );
      app.exit(1);
    });
}
