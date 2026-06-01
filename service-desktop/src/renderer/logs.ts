/**
 * Logs renderer: shows the recent service-node log buffer and appends new lines
 * as they stream over the bridge.
 *
 * @module renderer/logs
 */

import { applyStaticTranslations, loadTranslations, t } from "./t.js";

/** Wire the logs view. */
async function init(): Promise<void> {
  await loadTranslations();
  applyStaticTranslations();

  const pre = document.getElementById("log-output");
  if (pre === null) {
    throw new Error("Missing element #log-output");
  }

  const append = (line: string): void => {
    pre.textContent = `${pre.textContent ?? ""}${line}`;
    pre.scrollTop = pre.scrollHeight;
  };

  const existing = await window.serviceNode.logs();
  pre.textContent = existing.length > 0 ? existing.join("") : t("logs.empty");
  window.serviceNode.onLogLine(append);
}

void init();
