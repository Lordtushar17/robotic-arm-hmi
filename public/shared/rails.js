/* =========================================================
   Top status rail + bottom event rail + global pointer.
   ========================================================= */

import { $ } from "./dom.js";
import { on } from "./store.js";

const startedAt = performance.now();
const MAX_LOG = 6;
let lastSyncAt = null;

export function initRails() {
  paintClock();
  setInterval(paintClock, 1000);

  const host = location.hostname || "local";
  const hostEl = $("railHost");
  if (hostEl) hostEl.textContent = host;

  on("status", (text) => {
    lastSyncAt = Date.now();
    paintSync();
    const led = $("railLed");
    if (!led) return;
    const t = String(text || "").toLowerCase();
    if (t.includes("unable") || t.includes("unavailable")) led.dataset.state = "offline";
    else if (t.includes("warn")) led.dataset.state = "warning";
    else led.dataset.state = "online";
  });

  setInterval(paintSync, 1000);
  on("message", (text) => appendEvent(text));

  // Global mouse tracking for the atmosphere grid
  let mouseRaf = null;
  window.addEventListener("pointermove", (e) => {
    if (mouseRaf) return;
    mouseRaf = requestAnimationFrame(() => {
      document.documentElement.style.setProperty("--mouse-x", `${e.clientX}px`);
      document.documentElement.style.setProperty("--mouse-y", `${e.clientY}px`);
      mouseRaf = null;
    });
  });
}

function pad(n) { return String(n).padStart(2, "0"); }

function paintClock() {
  const now = new Date();
  const clockEl = $("railClock");
  if (clockEl) clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const up = Math.floor((performance.now() - startedAt) / 1000);
  const uptimeEl = $("railUptime");
  if (uptimeEl) {
    const h = Math.floor(up / 3600);
    const m = Math.floor((up % 3600) / 60);
    const s = up % 60;
    uptimeEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
}

function paintSync() {
  const el = $("railSync");
  if (!el) return;
  if (lastSyncAt === null) { el.textContent = "—s ago"; return; }
  const secs = Math.max(0, Math.round((Date.now() - lastSyncAt) / 1000));
  el.textContent = `${secs}s ago`;
}

function appendEvent(text) {
  const ticker = $("eventTicker");
  if (!ticker || !text) return;

  const time = new Date();
  const stamp = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
  const row = document.createElement("span");
  row.className = "event-item";
  const timeEl = document.createElement("strong");
  timeEl.textContent = `${stamp} `;
  row.append(timeEl, document.createTextNode(String(text)));
  ticker.replaceChildren(row);

  const history = appendEvent._history || (appendEvent._history = []);
  history.unshift(row);
  history.length = Math.min(history.length, MAX_LOG);
}