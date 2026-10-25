/* =========================================================
   Top bar section: server/controller/camera status pills
   and the theme switch.
   ========================================================= */

import { $ } from "../../shared/dom.js";
import { apiRequest } from "../../shared/api.js";
import { emit } from "../../shared/store.js";

export function initTopbar() {
  initTheme();
  refreshStatus();
  setInterval(refreshStatus, 5000);
}

/* ---------- Status ---------- */

function setDot(element, state) {
  if (!element) return;
  element.className = "dot";
  if (state === "online") element.classList.add("status-green");
  else if (state === "warning") element.classList.add("status-amber");
  else if (state === "offline") element.classList.add("status-red");
}

async function refreshStatus() {
  try {
    const data = await apiRequest("/api/status");
    const online = data.system === "online";
    const arduinoOn = data.arduino === "connected";
    const cameraText = data.camera || "Unknown";
    const cameraOn = /^(connected|online|ready)$/i.test(cameraText);

    $("systemStatus").textContent = online ? "Online" : "Offline";
    setDot($("systemDot"), online ? "online" : "offline");

    $("arduinoStatus").textContent = arduinoOn ? "Connected" : "Disconnected";
    setDot($("arduinoDot"), arduinoOn ? "online" : "warning");

    $("cameraStatus").textContent = cameraText.charAt(0).toUpperCase() + cameraText.slice(1);
    setDot($("cameraDot"), cameraOn ? "online" : "warning");

    emit("status", `Last updated ${new Date().toLocaleTimeString()}`);
  } catch {
    $("systemStatus").textContent = "Unavailable";
    setDot($("systemDot"), "offline");
    emit("status", "Unable to reach the server");
  }
}

/* ---------- Theme ---------- */

function applyTheme(theme) {
  const dark = theme === "dark";
  const toggle = $("themeToggle");
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  toggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  toggle.title = dark ? "Switch to light theme" : "Switch to dark theme";
  
  // Update browser meta theme color
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#0a0e13" : "#edf1f5";
  
  // Refresh the twin if needed (colors sometimes need a nudge)
  emit("theme:changed", theme);
}

function initTheme() {
  // Determine starting theme
  let currentTheme = document.documentElement.dataset.theme || "dark";
  applyTheme(currentTheme);

  $("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem("robotic-arm-theme", next);
    } catch {
      // Ignore storage errors
    }
  });
}