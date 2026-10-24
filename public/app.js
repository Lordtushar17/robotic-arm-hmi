const jointNames = [
  "J1 · Base Rotation",
  "J2 · Shoulder",
  "J3 · Elbow",
  "J4 · Wrist Pitch",
  "J5 · Gripper / Wrist",
  "J6 · Wrist Roll"
];

const DEFAULT_ANGLES = [90, 90, 90, 90, 90, 90];

let angles = [...DEFAULT_ANGLES];
let operation = "Idle";
let savedPoses = [];
let posesLoading = false;

const $ = (id) => document.getElementById(id);

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

async function refreshSavedPoses() {
  posesLoading = true;

  try {
    const data = await apiRequest("/api/poses");
    savedPoses = Array.isArray(data.poses) ? data.poses : [];
    renderSavedPoses();
  } catch (error) {
    $("savedPoses").replaceChildren();

    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "Could not load saved poses. Check the server connection.";
    $("savedPoses").append(message);

    $("controlMessage").textContent =
      `Could not load poses: ${error.message}`;
  } finally {
    posesLoading = false;
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
    empty.textContent = posesLoading
      ? "Loading saved poses..."
      : "No poses saved yet.";
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
    values.textContent = pose.angles
      .map((angle, index) => `J${index + 1}: ${angle}°`)
      .join(" · ");

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

async function savePose(event) {
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

  const submitButton = $("savePoseForm").querySelector(
    'button[type="submit"]'
  );
  submitButton.disabled = true;

  try {
    const data = await apiRequest("/api/poses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name,
        angles: [...angles]
      })
    });

    await refreshSavedPoses();
    $("poseName").value = "";

    $("controlMessage").textContent =
      `Saved "${name}" on the server. Simulation only.`;
  } catch (error) {
    $("controlMessage").textContent =
      `Could not save pose: ${error.message}`;
  } finally {
    submitButton.disabled = false;
  }
}

function loadPose(id) {
  const pose = savedPoses.find((item) => item.id === id);
  if (!pose) return;

  angles = [...pose.angles];
  renderJoints();

  $("controlMessage").textContent =
    `Loaded "${pose.name}". No physical movement occurred.`;
}

async function deletePose(id) {
  const pose = savedPoses.find((item) => item.id === id);
  if (!pose) return;

  try {
    await apiRequest(`/api/poses/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });

    await refreshSavedPoses();

    $("controlMessage").textContent =
      `Deleted "${pose.name}" from the server.`;
  } catch (error) {
    $("controlMessage").textContent =
      `Could not delete pose: ${error.message}`;
  }
}

async function refreshStatus() {
  try {
    const data = await apiRequest("/api/status");
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
refreshSavedPoses();
refreshStatus();

setInterval(refreshStatus, 5000);



/* =========================================================
   CROSS-PLATFORM VOICE INPUT
   Runs on Windows, phones, tablets and Raspberry Pi browsers.
   The microphone belongs to the device running the browser.
   Audio is recorded locally for now; transcription comes later.
   ========================================================= */

const micPermissionBtn = $("micPermissionBtn");
const talkBtn = $("talkBtn");
const voiceStatus = $("voiceStatus");
const recordingPreview = $("recordingPreview");

let microphoneReady = false;
let activeRecorder = null;
let activeStream = null;
let recordedChunks = [];
let recordingUrl = null;

function setVoiceStatus(message) {
  if (voiceStatus) {
    voiceStatus.textContent = message;
  }
}

function stopMicrophoneTracks() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
}

function resetTalkButton() {
  talkBtn.textContent = "🎙 Talk";
  talkBtn.classList.remove("btn-stop");
  talkBtn.classList.add("btn-primary");
  talkBtn.disabled = !microphoneReady;
}

function explainMicrophoneAvailability() {
  // Microphone APIs require a secure browser context.
  if (!window.isSecureContext) {
    setVoiceStatus(
      "Microphone access requires HTTPS on your phone. " +
      "Open this HMI using HTTPS, or use localhost on this device."
    );
    micPermissionBtn.disabled = true;
    talkBtn.disabled = true;
    return;
  }

  if (!navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function") {
    setVoiceStatus(
      "This browser does not provide microphone access. " +
      "Try an updated version of Chrome, Safari or Edge."
    );
    micPermissionBtn.disabled = true;
    talkBtn.disabled = true;
    return;
  }

  if (!window.MediaRecorder) {
    setVoiceStatus(
      "Microphone access is available, but audio recording " +
      "is not supported by this browser."
    );
    micPermissionBtn.disabled = false;
    talkBtn.disabled = true;
    return;
  }

  setVoiceStatus(
    "Microphone support detected. Select Enable microphone " +
    "and allow permission when your browser asks."
  );
  micPermissionBtn.disabled = false;
  talkBtn.disabled = true;
}

// Request permission only after the user presses the button.
micPermissionBtn.addEventListener("click", async () => {
  if (!window.isSecureContext) {
    explainMicrophoneAvailability();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    explainMicrophoneAvailability();
    return;
  }

  micPermissionBtn.disabled = true;
  setVoiceStatus("Requesting microphone permission…");

  try {
    // Request access from the device running this browser.
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    microphoneReady = true;
    stopMicrophoneTracks();

    talkBtn.disabled = false;
    setVoiceStatus(
      "Microphone ready. Tap Talk, speak your command, " +
      "then tap Stop recording."
    );
  } catch (error) {
    microphoneReady = false;
    talkBtn.disabled = true;

    if (error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError") {
      setVoiceStatus(
        "Microphone permission was denied or blocked. " +
        "Allow microphone access in your browser/site settings " +
        "and try again."
      );
    } else if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError"
    ) {
      setVoiceStatus(
        "No usable microphone was found on this device. " +
        "Connect or enable a microphone and try again."
      );
    } else if (
      error.name === "NotReadableError" ||
      error.name === "TrackStartError"
    ) {
      setVoiceStatus(
        "The microphone could not be opened. It may be in use " +
        "by another application or blocked by the operating system."
      );
    } else {
      setVoiceStatus(
        `Could not access the microphone: ${error.message || error.name}`
      );
    }
  } finally {
    micPermissionBtn.disabled = false;
  }
});

talkBtn.addEventListener("click", async () => {
  // Stop an existing recording.
  if (activeRecorder?.state === "recording") {
    activeRecorder.stop();
    talkBtn.disabled = true;
    setVoiceStatus("Finishing recording…");
    return;
  }

  if (!microphoneReady) {
    setVoiceStatus("Enable microphone access before recording.");
    return;
  }

  if (!window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder) {
    microphoneReady = false;
    explainMicrophoneAvailability();
    return;
  }

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    recordedChunks = [];

    const supportedTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4"
    ];

    const mimeType = supportedTypes.find((type) =>
      MediaRecorder.isTypeSupported(type)
    );

    activeRecorder = mimeType
      ? new MediaRecorder(activeStream, { mimeType })
      : new MediaRecorder(activeStream);

    activeRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    activeRecorder.addEventListener("stop", () => {
      const actualType = activeRecorder.mimeType || "audio/webm";
      const audioBlob = new Blob(recordedChunks, {
        type: actualType
      });

      stopMicrophoneTracks();
      resetTalkButton();

      if (audioBlob.size === 0) {
        setVoiceStatus("No audio was recorded. Please try again.");
        return;
      }

      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
      }

      recordingUrl = URL.createObjectURL(audioBlob);
      recordingPreview.src = recordingUrl;
      recordingPreview.hidden = false;

      const sizeKb = Math.max(1, Math.round(audioBlob.size / 1024));

      setVoiceStatus(
        `Recording complete (${sizeKb} KB). Playback is available below. ` +
        "Audio has not yet been sent to the speech-recognition model."
      );
    }, { once: true });

    activeRecorder.addEventListener("error", (event) => {
      stopMicrophoneTracks();
      resetTalkButton();

      setVoiceStatus(
        `Recording failed: ${event.error?.message || "browser recorder error"}`
      );
    }, { once: true });

    activeRecorder.start();

    talkBtn.textContent = "■ Stop recording";
    talkBtn.classList.remove("btn-primary");
    talkBtn.classList.add("btn-stop");
    setVoiceStatus("Recording… speak now, then tap Stop recording.");
  } catch (error) {
    stopMicrophoneTracks();
    resetTalkButton();

    setVoiceStatus(
      `Could not start recording: ${error.message || error.name}`
    );
  }
});

// Detect capabilities on the device opening the page.
// Do not request permission automatically on page load.
explainMicrophoneAvailability();

// Release any generated playback URL when leaving the page.
window.addEventListener("pagehide", () => {
  stopMicrophoneTracks();

  if (recordingUrl) {
    URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
  }
});
