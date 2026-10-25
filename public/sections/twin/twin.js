/* =========================================================
   Digital twin section.
   Illustrative side view. Link lengths and joint zero points are
   approximations, not your arm's real calibration.
   90 degrees on every joint is the neutral pose
   (upper arm vertical, forearm horizontal).
   SIMULATION ONLY: nothing here talks to the Arduino.
   ========================================================= */

import { $ } from "../../shared/dom.js";
import { state, on, isPending } from "../../shared/store.js";

const SHOULDER = { x: 250, y: 290 };
const L1 = 110, L2 = 92, L3 = 40;
const MAX_REACH = L1 + L2 + L3;
const RAD = Math.PI / 180;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// What the twin currently draws. It eases toward state.angles.
// It starts in a folded pose so the arm "wakes up" into neutral on load.
let shown = [90, 28, 168, 90, 150, 90];
let twinFrame = null;

export function initTwin() {
  on("angles", () => {
    updateReadouts();
    animateTwin();
    updateGhost();
  });
  on("applied", () => {
    updateGhost();
    renderTwin();
  });
  on("joint:active", (index) => {
    $("stage").dataset.active = index === null ? "" : String(index);
  });

  initSpotlight();
  initRunControls();

  updateReadouts();
  animateTwin();
  updateGhost();
}

/* ---------- Geometry ---------- */

function solveArm(a) {
  const p1 = (a[1] - 90) * RAD;
  const p2 = p1 + (180 - a[2]) * RAD;
  const p3 = p2 + (a[3] - 90) * RAD;

  const elbow = { x: SHOULDER.x + L1 * Math.sin(p1), y: SHOULDER.y - L1 * Math.cos(p1) };
  const wrist = { x: elbow.x + L2 * Math.sin(p2), y: elbow.y - L2 * Math.cos(p2) };
  const tip = { x: wrist.x + L3 * Math.sin(p3), y: wrist.y - L3 * Math.cos(p3) };

  return { elbow, wrist, tip, p3, reach: tip.x - SHOULDER.x };
}

function setLine(el, x1, y1, x2, y2) {
  el.setAttribute("x1", x1.toFixed(1));
  el.setAttribute("y1", y1.toFixed(1));
  el.setAttribute("x2", x2.toFixed(1));
  el.setAttribute("y2", y2.toFixed(1));
}

function setCircle(el, p) {
  el.setAttribute("cx", p.x.toFixed(1));
  el.setAttribute("cy", p.y.toFixed(1));
}

/* ---------- Drawing ---------- */

function renderTwin() {
  const a = shown;
  const { elbow, wrist, p3, reach } = solveArm(a);

  setLine($("upperBody"), SHOULDER.x, SHOULDER.y, elbow.x, elbow.y);
  setLine($("upperHl"), SHOULDER.x, SHOULDER.y, elbow.x, elbow.y);
  setLine($("foreBody"), elbow.x, elbow.y, wrist.x, wrist.y);
  setLine($("foreHl"), elbow.x, elbow.y, wrist.x, wrist.y);

  setCircle($("jElbow"), elbow);
  setCircle($("cElbow"), elbow);
  setCircle($("jWrist"), wrist);
  setCircle($("cWrist"), wrist);

  // Hand: palm along the wrist direction, two fingers that spread with J5.
  const dir = { x: Math.sin(p3), y: -Math.cos(p3) };
  const side = { x: -dir.y, y: dir.x };
  const palmEnd = { x: wrist.x + dir.x * 14, y: wrist.y + dir.y * 14 };
  setLine($("palm"), wrist.x, wrist.y, palmEnd.x, palmEnd.y);

  const spread = (4 + (a[4] / 180) * 26) * RAD;
  const fingerLen = 26;
  [["fingerA", 1], ["fingerB", -1]].forEach(([id, sign]) => {
    const fa = p3 + sign * spread;
    setLine(
      $(id),
      palmEnd.x + side.x * sign * 4, palmEnd.y + side.y * sign * 4,
      palmEnd.x + Math.sin(fa) * fingerLen + side.x * sign * 4,
      palmEnd.y - Math.cos(fa) * fingerLen + side.y * sign * 4
    );
  });

  // Top-view dial: needle direction from J1, length from horizontal reach.
  const r1 = (a[0] - 90) * RAD;
  const len = (reach / MAX_REACH) * 44;
  const needle = $("baseNeedle");
  needle.setAttribute("x2", (60 + Math.sin(r1) * len).toFixed(1));
  needle.setAttribute("y2", (64 - Math.cos(r1) * len).toFixed(1));

  $("rollBar").setAttribute("transform", `rotate(${(a[5] - 90).toFixed(1)} 60 60)`);

  // Dashed outline of the applied pose.
  const ghost = solveArm(state.applied);
  $("ghostLine").setAttribute(
    "points",
    [SHOULDER, ghost.elbow, ghost.wrist, ghost.tip]
      .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ")
  );
}

function animateTwin() {
  if (REDUCED_MOTION) {
    shown = [...state.angles];
    renderTwin();
    return;
  }

  if (twinFrame) return;

  const step = () => {
    let moving = false;
    shown = shown.map((value, i) => {
      const diff = state.angles[i] - value;
      if (Math.abs(diff) < 0.08) return state.angles[i];
      moving = true;
      return value + diff * 0.16;
    });

    renderTwin();
    twinFrame = moving ? requestAnimationFrame(step) : null;
  };

  twinFrame = requestAnimationFrame(step);
}

function updateGhost() {
  $("ghostLine").classList.toggle("on", isPending());
}

function updateReadouts() {
  $("readJ1").textContent = `${state.angles[0]}°`;
  $("readJ6").textContent = `${state.angles[5]}°`;
}

/* ---------- Pointer spotlight + grid reveal ---------- */

function initSpotlight() {
  const stage = $("stage");
  stage.addEventListener("pointermove", (event) => {
    const box = stage.getBoundingClientRect();
    stage.style.setProperty("--mx", `${event.clientX - box.left}px`);
    stage.style.setProperty("--my", `${event.clientY - box.top}px`);
  });
}

/* ---------- Run state (Start / Pause / Stop, simulation only) ---------- */

function initRunControls() {
  const buttons = { Running: $("startBtn"), Paused: $("pauseBtn"), Stopped: $("stopBtn") };

  function setOperation(next) {
    Object.entries(buttons).forEach(([name, btn]) => {
      btn.setAttribute("aria-pressed", String(name === next));
    });
    $("operationStatus").textContent = `Simulation ${next.toLowerCase()}. No hardware commands sent.`;
  }

  $("startBtn").addEventListener("click", () => setOperation("Running"));
  $("pauseBtn").addEventListener("click", () => setOperation("Paused"));
  $("stopBtn").addEventListener("click", () => setOperation("Stopped"));

  setOperation("Idle");
}
