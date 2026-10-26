/* =========================================================
   App entry point.
   1. Fetch every section's HTML file and drop it into the page.
   2. Start each section's JavaScript.
   ========================================================= */

import { emit } from "./shared/store.js";
import { initRails } from "./shared/rails.js";
import { initTopbar } from "./sections/topbar/topbar.js";
import { initTwin } from "./sections/twin/twin.js";
import { initVoice } from "./sections/voice/voice.js";
import { initJoints } from "./sections/joints/joints.js";
import { initPoses } from "./sections/poses/poses.js";

const SECTIONS = [
  ["rails", initRails],
  ["twin", initTwin],
  ["joints", initJoints],
  ["poses", initPoses],
  ["voice", initVoice],
  ["topbar", initTopbar]
];

function errorFragment(url, message) {
  const box = document.createElement("section");
  box.className = "panel";
  const title = document.createElement("h2");
  title.textContent = "This section could not load";
  const detail = document.createElement("p");
  detail.className = "muted";
  detail.textContent = `${url}: ${message}`;
  box.append(title, detail);
  return box;
}

async function loadSections() {
  const slots = [...document.querySelectorAll("[data-include]")];

  const loaded = await Promise.all(
    slots.map(async (slot) => {
      const url = slot.dataset.include;
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { slot, html: await response.text() };
      } catch (error) {
        return { slot, url, error: error.message };
      }
    })
  );

  loaded.forEach(({ slot, html, url, error }) => {
    if (error) {
      slot.replaceWith(errorFragment(url, error));
      return;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    slot.replaceWith(template.content);
  });
}

async function start() {
  await loadSections();

  for (const [name, init] of SECTIONS) {
    try {
      init();
    } catch (error) {
      console.error(`Section "${name}" failed to start:`, error);
    }
  }

  emit("angles");
  emit("applied");
}

start();
