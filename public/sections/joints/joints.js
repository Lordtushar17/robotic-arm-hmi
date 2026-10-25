/* =========================================================
   Joint positions section.
   Sliders, +/- steppers, Reset and Apply.
   SIMULATION ONLY: nothing here moves the physical arm.
   ========================================================= */

import { $ } from "../../shared/dom.js";
import {
  state, on, emit, setAngle, applyAngles, resetAngles, say, isPending
} from "../../shared/store.js";

const JOINTS = [
  { id: "J1", name: "Base rotation" },
  { id: "J2", name: "Shoulder" },
  { id: "J3", name: "Elbow" },
  { id: "J4", name: "Wrist pitch" },
  { id: "J5", name: "Gripper" },
  { id: "J6", name: "Wrist roll" }
];

const rows = [];

export function initJoints() {
  buildJoints();
  syncAll();

  on("angles", () => {
    syncAll();
    updatePending();
  });
  on("applied", updatePending);
  on("message", (text) => {
    $("controlMessage").textContent = text;
  });

  $("homeBtn").addEventListener("click", () => {
    resetAngles();
    say("All joints reset to 90°. Simulation only.");
  });

  $("applyBtn").addEventListener("click", () => {
    applyAngles();
    say(`Positions applied: ${state.angles.map((a) => `${a}°`).join(", ")}. The physical arm did not move.`);
  });

  updatePending();
}

function setActive(index) {
  rows.forEach((ui, i) => ui.row.classList.toggle("is-active", i === index));
  emit("joint:active", index);
}

function buildJoints() {
  const container = $("jointControls");
  container.replaceChildren();

  JOINTS.forEach((joint, index) => {
    const row = document.createElement("div");
    row.className = "joint-row";

    const name = document.createElement("label");
    name.className = "joint-name";
    name.htmlFor = `joint-${index}`;
    const badge = document.createElement("span");
    badge.className = "joint-id";
    badge.textContent = joint.id;
    name.append(badge, document.createTextNode(joint.name));

    const valueBox = document.createElement("div");
    valueBox.className = "joint-value";

    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "step-btn";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `Decrease ${joint.name} by 1 degree`);

    const output = document.createElement("output");
    output.className = "angle-value";
    output.htmlFor = `joint-${index}`;

    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "step-btn";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `Increase ${joint.name} by 1 degree`);

    valueBox.append(minus, output, plus);

    const wrap = document.createElement("div");
    wrap.className = "slider-wrap";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = `joint-${index}`;
    slider.min = "0";
    slider.max = "180";
    slider.step = "1";
    slider.setAttribute("aria-label", `${joint.name} angle`);
    wrap.append(slider);

    const limits = document.createElement("div");
    limits.className = "range-limits";
    limits.innerHTML = "<span>0°</span><span>90°</span><span>180°</span>";

    row.append(name, valueBox, wrap, limits);
    container.append(row);

    const change = (next) => {
      setAngle(index, next);
      say("Position changed. Press Apply positions to confirm.");
    };

    slider.addEventListener("input", () => change(Number(slider.value)));
    minus.addEventListener("click", (e) => change(state.angles[index] - (e.shiftKey ? 10 : 1)));
    plus.addEventListener("click", (e) => change(state.angles[index] + (e.shiftKey ? 10 : 1)));

    row.addEventListener("focusin", () => setActive(index));
    row.addEventListener("pointerenter", () => setActive(index));

    rows.push({ row, slider, output });
  });

  container.addEventListener("pointerleave", () => {
    if (!container.contains(document.activeElement)) setActive(null);
  });
  container.addEventListener("focusout", (event) => {
    if (!container.contains(event.relatedTarget)) setActive(null);
  });
}

function syncAll() {
  state.angles.forEach((value, i) => {
    const ui = rows[i];
    ui.slider.value = String(value);
    ui.slider.style.setProperty("--pct", `${(value / 180) * 100}%`);
    ui.output.textContent = `${value}°`;
  });
}

function updatePending() {
  $("pendingChip").hidden = !isPending();
}
