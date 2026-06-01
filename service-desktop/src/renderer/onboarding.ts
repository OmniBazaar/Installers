/**
 * Onboarding wizard renderer: collect credentials → derive + show the address →
 * provision OS dependencies (with a progress bar) → persist credentials and
 * start the node. Authoritative qualification is enforced by the running node;
 * this screen is informational about the derived identity.
 *
 * @module renderer/onboarding
 */

import { applyStaticTranslations, loadTranslations, t } from "./t.js";

/** Get a required element by id, throwing if the markup is missing it. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Missing element #${id}`);
  }
  return node as T;
}

/** Show an error message in the status line. */
function showError(message: string): void {
  const status = el<HTMLParagraphElement>("status");
  status.textContent = `${t("onboarding.errorPrefix")} ${message}`;
  status.className = "status error";
}

/** Wire the onboarding flow once translations are loaded. */
async function init(): Promise<void> {
  await loadTranslations();
  applyStaticTranslations();

  const username = el<HTMLInputElement>("username");
  const password = el<HTMLInputElement>("password");
  const nextBtn = el<HTMLButtonElement>("next");
  const addressBox = el<HTMLDivElement>("address-box");
  const addressValue = el<HTMLSpanElement>("address-value");
  const startBtn = el<HTMLButtonElement>("start");
  const progress = el<HTMLProgressElement>("progress");
  const status = el<HTMLParagraphElement>("status");

  window.serviceNode.onProvisionProgress((event) => {
    status.className = "status";
    status.textContent = event.message;
    if (event.percent !== undefined) {
      progress.value = event.percent;
      progress.hidden = false;
    }
  });

  nextBtn.addEventListener("click", () => {
    void (async () => {
      nextBtn.disabled = true;
      status.textContent = "";
      try {
        const info = await window.serviceNode.preflight(
          username.value,
          password.value,
        );
        addressValue.textContent = info.address;
        addressBox.hidden = false;
        startBtn.hidden = false;
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      } finally {
        nextBtn.disabled = false;
      }
    })();
  });

  startBtn.addEventListener("click", () => {
    void (async () => {
      startBtn.disabled = true;
      try {
        status.textContent = t("onboarding.provisioning");
        await window.serviceNode.provision();
        await window.serviceNode.complete(username.value, password.value);
        window.location.href = "dashboard.html";
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
        startBtn.disabled = false;
      }
    })();
  });
}

void init();
