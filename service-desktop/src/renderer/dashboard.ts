/**
 * Dashboard renderer: shows live node status, start/stop controls, the dashboard
 * link, autostart toggle, and an update check. Status updates arrive over the
 * bridge event stream.
 *
 * @module renderer/dashboard
 */

import { applyStaticTranslations, loadTranslations, t } from "./t.js";

/** Get a required element by id. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

/** Map a status to its localised label and indicator class. */
function renderStatus(status: ServiceStatus): void {
  const indicator = el<HTMLSpanElement>("status-indicator");
  const label = el<HTMLSpanElement>("status-label");
  label.textContent = t(`tray.status.${status}`);
  indicator.className = `indicator ${status}`;
  el<HTMLButtonElement>("start").hidden = status === "running" || status === "starting";
  el<HTMLButtonElement>("stop").hidden = status === "stopped" || status === "error";
}

/** Wire the dashboard. */
async function init(): Promise<void> {
  await loadTranslations();
  applyStaticTranslations();

  window.serviceNode.onStatusChanged(renderStatus);
  renderStatus(await window.serviceNode.status());

  el<HTMLButtonElement>("start").addEventListener("click", () => {
    void window.serviceNode.start();
  });
  el<HTMLButtonElement>("stop").addEventListener("click", () => {
    void window.serviceNode.stop();
  });
  el<HTMLButtonElement>("dashboard-link").addEventListener("click", () => {
    void window.serviceNode.openDashboard();
  });
  el<HTMLButtonElement>("logs-link").addEventListener("click", () => {
    window.location.href = "logs.html";
  });

  const autostart = el<HTMLInputElement>("autostart");
  autostart.checked = await window.serviceNode.getAutostart();
  autostart.addEventListener("change", () => {
    void window.serviceNode.setAutostart(autostart.checked);
  });

  el<HTMLButtonElement>("check-updates").addEventListener("click", () => {
    void (async () => {
      const result = el<HTMLParagraphElement>("update-result");
      result.textContent = "…";
      try {
        const check = await window.serviceNode.checkUpdates();
        result.textContent = check.updateAvailable
          ? t("updates.available", { version: check.latest })
          : t("updates.upToDate");
      } catch (err) {
        result.textContent = err instanceof Error ? err.message : String(err);
      }
    })();
  });
}

void init();
