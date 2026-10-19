
const jointNames = [
  "J1 · Base Rotation",
  "J2 · Shoulder",
  "J3 · Elbow",
  "J4 · Wrist Pitch",
  "J5 · Gripper / Wrist"
];

const DEFAULT_ANGLES = [90, 90, 90, 90, 90];
let angles = [...DEFAULT_ANGLES];
let operation = "Idle";

const $ = (id) => document.getElementById(id);

function setDot(element, state) {
  element.className = "status-dot";

  if (state === "online") {
    element.classList.add("status-green");
  } else if (state === "warning") {
    element.classList.add("status-amber");
  } else if (state === "offline") {
    element.classList.add("status-red");
  }
}

function renderJoints() {
  const container = $("jointControls");
  container.replaceChildren();

  jointNames.forEach((name, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "joint-control";

    const header = document.createElement("div");
    header.className = "joint-header";

    const label = document.createElement("label");
    label.htmlFor = `joint-${index}`;
    label.textContent = name;

    const value = document.createElement("output");
    value.className = "angle-value";
    value.id = `angle-${index}`;
    value.htmlFor = `joint-${index}`;
    value.textContent = `${angles[index]}°`;

    header.append(label, value);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = `joint-${index}`;
    slider.min = "0";
    slider.max = "180";
    slider.step = "1";
    slider.value = String(angles[index]);
    slider.setAttribute("aria-label", `${name} angle`);

    slider.addEventListener("input", () => {
      angles[index] = Number(slider.value);
      value.textContent = `${angles[index]}°`;
      $("controlMessage").textContent =
        "Position changed locally. Press Apply Positions to confirm.";
    });

    const limits = document.createElement("div");
    limits.className = "range-limits";

    const min = document.createElement("span");
    min.textContent = "0°";

    const max = document.createElement("span");
    max.textContent = "180°";

    limits.append(min, max);
    wrapper.append(header, slider, limits);
    container.append(wrapper);
  });
}

function updateStatus(data) {
  const online = data.system === "online";

  $("systemStatus").textContent = online ? "Server Online" : "Server Offline";
  $("systemCard").textContent = online ? "Online" : "Offline";
  $("arduinoStatus").textContent =
    data.arduino === "connected" ? "Connected" : "Disconnected";
  $("arduinoCard").textContent =
    data.arduino === "connected" ? "Connected" : "Offline";
  $("cameraCard").textContent = data.camera || "Unknown";

  $("systemDot").className = "status-dot";
  setDot($("systemDot"), online ? "online" : "offline");

  $("lastUpdated").textContent =
    `Last updated: ${new Date().toLocaleTimeString()}`;
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("Status request failed");
    }

    const data = await response.json();
    updateStatus(data);
  } catch (error) {
    $("systemStatus").textContent = "Server Unavailable";
    $("systemCard").textContent = "Offline";
    setDot($("systemDot"), "offline");
    $("lastUpdated").textContent = "Unable to fetch server status";
  }
}

function setOperation(nextOperation) {
  operation = nextOperation;

  $("operationStatus").textContent =
    `Simulation state: ${operation}. No hardware commands sent.`;
}

function resetSimulation() {
  angles = [...DEFAULT_ANGLES];
  renderJoints();

  $("controlMessage").textContent =
    "Joint positions reset to 90°. Simulation only.";
}

$("homeBtn").addEventListener("click", resetSimulation);

$("applyBtn").addEventListener("click", () => {
  $("controlMessage").textContent =
    `Simulation positions applied: ${angles.join("°, ")}°. No robot movement occurred.`;
});

$("startBtn").addEventListener("click", () => {
  setOperation("Running");
});

$("pauseBtn").addEventListener("click", () => {
  setOperation("Paused");
});

$("stopBtn").addEventListener("click", () => {
  setOperation("Stopped");
});

renderJoints();
refreshStatus();
setInterval(refreshStatus, 5000);
