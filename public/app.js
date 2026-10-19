
const jointNames = [
  "J1 · Base Rotation",
  "J2 · Shoulder",
  "J3 · Elbow",
  "J4 · Wrist Pitch",
  "J5 · Gripper / Wrist"
];

const DEFAULT_ANGLES = [90, 90, 90, 90, 90];
const STORAGE_KEY = "roboticArmSavedPoses";

let angles = [...DEFAULT_ANGLES];
let operation = "Idle";
let savedPoses = loadSavedPoses();

const $ = (id) => document.getElementById(id);

function loadSavedPoses() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (!Array.isArray(stored)) return [];

    return stored.filter((pose) =>
      pose &&
      typeof pose.id === "string" &&
      typeof pose.name === "string" &&
      Array.isArray(pose.angles) &&
      pose.angles.length === 5 &&
      pose.angles.every(
        (angle) => Number.isInteger(angle) && angle >= 0 && angle <= 180
      )
    );
  } catch {
    return [];
  }
}

function persistSavedPoses() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPoses));
    return true;
  } catch {
    $("controlMessage").textContent =
      "Could not save poses in this browser.";
    return false;
  }
}

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

function renderSavedPoses() {
  const container = $("savedPoses");
  container.replaceChildren();

  $("poseCount").textContent =
    `${savedPoses.length} saved`;

  if (savedPoses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No poses saved yet.";
    container.append(empty);
    return;
  }

  savedPoses.forEach((pose) => {
    const card = document.createElement("div");
    card.className = "saved-pose";

    const info = document.createElement("div");
    info.className = "saved-pose-info";

    const name = document.createElement("strong");
    name.textContent = pose.name;

    const values = document.createElement("span");
    values.textContent =
      pose.angles.map((angle, index) =>
        `J${index + 1}: ${angle}°`
      ).join(" · ");

    info.append(name, values);

    const actions = document.createElement("div");
    actions.className = "saved-pose-actions";

    const loadButton = document.createElement("button");
    loadButton.className = "btn btn-secondary";
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => loadPose(pose.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn btn-secondary pose-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deletePose(pose.id));

    actions.append(loadButton, deleteButton);
    card.append(info, actions);
    container.append(card);
  });
}

function savePose(event) {
  event.preventDefault();

  const name = $("poseName").value.trim();

  if (!name) {
    $("controlMessage").textContent = "Enter a name for this pose.";
    return;
  }

  if (savedPoses.length >= 50) {
    $("controlMessage").textContent =
      "Pose limit reached. Delete a pose before saving another.";
    return;
  }

  if (savedPoses.some((pose) =>
    pose.name.toLowerCase() === name.toLowerCase()
  )) {
    $("controlMessage").textContent =
      "A pose with that name already exists. Choose another name.";
    return;
  }

  const pose = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    angles: [...angles]
  };

  savedPoses.push(pose);

  if (!persistSavedPoses()) {
    savedPoses.pop();
    return;
  }

  renderSavedPoses();
  $("poseName").value = "";
  $("controlMessage").textContent =
    `Saved "${name}" in this browser. Simulation only.`;
}

function loadPose(id) {
  const pose = savedPoses.find((item) => item.id === id);
  if (!pose) return;

  angles = [...pose.angles];
  renderJoints();

  $("controlMessage").textContent =
    `Loaded "${pose.name}". No physical movement occurred.`;
}

function deletePose(id) {
  const pose = savedPoses.find((item) => item.id === id);
  if (!pose) return;

  savedPoses = savedPoses.filter((item) => item.id !== id);

  if (!persistSavedPoses()) {
    savedPoses.push(pose);
    return;
  }

  renderSavedPoses();
  $("controlMessage").textContent =
    `Deleted "${pose.name}".`;
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
    const online = data.system === "online";

    $("systemStatus").textContent =
      online ? "Server Online" : "Server Offline";
    $("systemCard").textContent = online ? "Online" : "Offline";

    $("arduinoStatus").textContent =
      data.arduino === "connected" ? "Connected" : "Disconnected";
    $("arduinoCard").textContent =
      data.arduino === "connected" ? "Connected" : "Offline";

    $("cameraCard").textContent = data.camera || "Unknown";

    setDot($("systemDot"), online ? "online" : "offline");

    $("lastUpdated").textContent =
      `Last updated: ${new Date().toLocaleTimeString()}`;
  } catch {
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

$("startBtn").addEventListener("click", () => setOperation("Running"));
$("pauseBtn").addEventListener("click", () => setOperation("Paused"));
$("stopBtn").addEventListener("click", () => setOperation("Stopped"));

$("savePoseForm").addEventListener("submit", savePose);

renderJoints();
renderSavedPoses();
refreshStatus();
setInterval(refreshStatus, 5000);
