/* =========================================================
   App entry point.
   1. Fetch every section's HTML file and drop it into the page.
   2. Start each section's JavaScript.
   Adding a section = one <div data-include> in index.html,
   one folder under sections/, and one line in SECTIONS below.
   ========================================================= */

import { emit } from "./shared/store.js";
import { initTopbar } from "./sections/topbar/topbar.js";
import { initTwin } from "./sections/twin/twin.js";
import { initVoice } from "./sections/voice/voice.js";
import { initJoints } from "./sections/joints/joints.js";
import { initPoses } from "./sections/poses/poses.js";
import { initFooter } from "./sections/footer/footer.js";

// Order matters a little: the twin and footer listen for events the others send.
const SECTIONS = [
  ["twin", initTwin],
  ["joints", initJoints],
  ["poses", initPoses],
  ["voice", initVoice],
  ["footer", initFooter],
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

  // Fetch everything in parallel, then insert in page order so nothing pops in out of place.
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
      // One broken section must not take the whole HMI down.
      console.error(`Section "${name}" failed to start:`, error);
    }
  }

  // Push the starting pose to every listener once everything is wired up.
  emit("angles");
  emit("applied");
}

start();
