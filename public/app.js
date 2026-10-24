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
    message.textContent =
      "Could not load saved poses. Check the server connection.";
    $("savedPoses").append(message);

    $("controlMessage").textContent =
      `Could not load poses: ${error.message}`;
  } finally {
    posesLoading = false;
  }
}

function setDot(element, state) {
  if (!element) return;

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
  if (!container) return;

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
  if (!container) return;

  container.replaceChildren();

  const poseCount = $("poseCount");
  if (poseCount) {
    poseCount.textContent = `${savedPoses.length} saved`;
  }

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

  if (
    savedPoses.some(
      (pose) => pose.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    $("controlMessage").textContent =
      "A pose with that name already exists. Choose another name.";
    return;
  }

  const submitButton = $("savePoseForm").querySelector(
    'button[type="submit"]'
  );

  submitButton.disabled = true;

  try {
    await apiRequest("/api/poses", {
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

    $("lastUpdated").textContent =
      "Unable to fetch server status";
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
   CROSS-PLATFORM VOICE INPUT + WHISPER UPLOAD

   Records audio in the browser and uploads it to the
   Raspberry Pi for local Whisper transcription.

   IMPORTANT:
   Transcription is implemented, but voice commands do not
   yet control the physical robotic arm.
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
let transcriptionInProgress = false;

const MAX_RECORDING_SECONDS = 20;

function setVoiceStatus(message, options = {}) {
  if (voiceStatus) {
    voiceStatus.textContent = message;
  }

  const isBusy = Boolean(options.busy);
  const loader = $("voiceLoader");
  const feedback = $("voiceFeedback");

  if (loader) {
    loader.hidden = !isBusy;
  }

  if (feedback) {
    feedback.setAttribute("aria-busy", String(isBusy));

    if (!isBusy) {
      feedback.classList.remove("is-recording");
    }
  }

  if (voiceStatus) {
    voiceStatus.classList.toggle("is-processing", isBusy);
  }
}

function stopMicrophoneTracks() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
}

function resetTalkButton() {
  if (!talkBtn) return;

  talkBtn.textContent = "🎙 Talk";
  talkBtn.classList.remove("btn-stop", "btn-processing");
  talkBtn.classList.add("btn-primary");
  talkBtn.disabled = !microphoneReady || transcriptionInProgress;
}

function explainMicrophoneAvailability() {
  if (!window.isSecureContext) {
    setVoiceStatus(
      "Microphone access requires HTTPS on your phone, " +
      "or localhost on this device."
    );

    micPermissionBtn.disabled = true;
    talkBtn.disabled = true;
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setVoiceStatus(
      "Microphone access is unavailable. Try an updated browser."
    );

    micPermissionBtn.disabled = true;
    talkBtn.disabled = true;
    return;
  }

  if (!window.MediaRecorder) {
    setVoiceStatus(
      "This browser supports microphone access but not audio recording."
    );

    micPermissionBtn.disabled = false;
    talkBtn.disabled = true;
    return;
  }

  setVoiceStatus(
    "Enable your microphone, record a short English command, " +
    "and stop recording to send it to Whisper."
  );

  micPermissionBtn.disabled = false;
  talkBtn.disabled = true;
}

// Upload browser-recorded audio to the Raspberry Pi.
// The server uses FFmpeg to convert the audio for Whisper.
async function sendAudioToWhisper(audioBlob) {
  transcriptionInProgress = true;
  talkBtn.disabled = true;
  micPermissionBtn.disabled = true;

  talkBtn.textContent = "Processing…";
  talkBtn.classList.remove("btn-primary", "btn-stop");
  talkBtn.classList.add("btn-processing");

  try {
    const uploadType = audioBlob.type || "audio/webm";

    setVoiceStatus(
      `Processing your ${Math.max(
        1,
        Math.round(audioBlob.size / 1024)
      )} KB recording. Uploading audio and running speech recognition on the Raspberry Pi…`,
      { busy: true }
    );

    const data = await apiRequest("/api/transcribe", {
      method: "POST",
      headers: {
        "Content-Type": uploadType
      },
      body: audioBlob
    });

    if (
      typeof data.transcript !== "string" ||
      !data.transcript.trim()
    ) {
      throw new Error("Whisper returned an empty transcription.");
    }

    setVoiceStatus(`Recognized: "${data.transcript.trim()}"`);
  } catch (error) {
    setVoiceStatus(
      `Transcription failed: ${error.message}. ` +
      "Check the Raspberry Pi server and try a short recording again."
    );
  } finally {
    transcriptionInProgress = false;
    micPermissionBtn.disabled = false;
    resetTalkButton();

    if (voiceStatus?.textContent.includes("Processing your")) {
      setVoiceStatus("Ready for your next command.");
    }
  }
}

// Request microphone permission after a user clicks the button.
micPermissionBtn.addEventListener("click", async () => {
  if (
    !window.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    explainMicrophoneAvailability();
    return;
  }

  micPermissionBtn.disabled = true;
  setVoiceStatus("Requesting microphone permission...");

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    microphoneReady = true;
    stopMicrophoneTracks();

    talkBtn.disabled = false;

    setVoiceStatus(
      "Microphone ready. Tap Talk, speak in English, " +
      "then tap Stop recording."
    );
  } catch (error) {
    microphoneReady = false;
    talkBtn.disabled = true;

    setVoiceStatus(
      `Could not access microphone: ${error.message || error.name}`
    );
  } finally {
    micPermissionBtn.disabled = false;
  }
});

talkBtn.addEventListener("click", async () => {
  // Stop the current recording when Talk is clicked again.
  if (activeRecorder?.state === "recording") {
    activeRecorder.stop();
    talkBtn.disabled = true;
    setVoiceStatus("Finishing recording...");
    return;
  }

  if (!microphoneReady || transcriptionInProgress) {
    return;
  }

  if (
    !window.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia ||
    !window.MediaRecorder
  ) {
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

    const recorder = activeRecorder;
    const recordingStartedAt = Date.now();

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    recorder.addEventListener(
      "stop",
      async () => {
        const actualType = recorder.mimeType || "audio/webm";

        const audioBlob = new Blob(recordedChunks, {
          type: actualType
        });

        stopMicrophoneTracks();

        if (audioBlob.size === 0) {
          resetTalkButton();
          setVoiceStatus("No audio was recorded. Please try again.");
          return;
        }

        if (recordingUrl) {
          URL.revokeObjectURL(recordingUrl);
        }

        recordingUrl = URL.createObjectURL(audioBlob);

        if (recordingPreview) {
          recordingPreview.src = recordingUrl;
          recordingPreview.hidden = false;
        }

        const durationSeconds =
          (Date.now() - recordingStartedAt) / 1000;

        if (durationSeconds > MAX_RECORDING_SECONDS) {
          resetTalkButton();

          setVoiceStatus(
            `Recording was ${Math.ceil(durationSeconds)} seconds. ` +
            `Please keep commands under ${MAX_RECORDING_SECONDS} seconds.`
          );

          return;
        }

        await sendAudioToWhisper(audioBlob);
      },
      { once: true }
    );

    recorder.addEventListener(
      "error",
      (event) => {
        stopMicrophoneTracks();
        resetTalkButton();

        setVoiceStatus(
          `Recording failed: ${
            event.error?.message || "browser recorder error"
          }`
        );
      },
      { once: true }
    );

    recorder.start();

    talkBtn.textContent = "■ Stop recording";
    talkBtn.classList.remove("btn-primary");
    talkBtn.classList.add("btn-stop");

    $("voiceFeedback")?.classList.add("is-recording");

    setVoiceStatus("Recording... speak your English command.");
  } catch (error) {
    stopMicrophoneTracks();
    resetTalkButton();

    setVoiceStatus(
      `Could not start recording: ${error.message || error.name}`
    );
  }
});


/* =========================================================
   THEME SWITCHER
   Saves the user's light/dark preference in this browser.
   ========================================================= */

const themeToggle = $("themeToggle");
const themeIcon = $("themeIcon");
const themeLabel = $("themeLabel");

function applyTheme(theme) {
  const dark = theme === "dark";

  document.documentElement.dataset.theme = dark ? "dark" : "light";

  if (themeIcon) {
    themeIcon.textContent = dark ? "☀" : "☾";
  }

  if (themeLabel) {
    themeLabel.textContent = dark ? "Light mode" : "Dark mode";
  }

  if (themeToggle) {
    themeToggle.setAttribute(
      "aria-label",
      dark ? "Switch to light theme" : "Switch to dark theme"
    );

    themeToggle.title = dark
      ? "Switch to light theme"
      : "Switch to dark theme";
  }

  const themeColor = document.querySelector(
    'meta[name="theme-color"]'
  );

  if (themeColor) {
    themeColor.content = dark ? "#0b1220" : "#f4f7fb";
  }
}

let savedTheme = "light";

try {
  savedTheme = localStorage.getItem("robotic-arm-theme") || "light";
} catch {
  // Continue with the default theme if local storage is unavailable.
}

applyTheme(savedTheme);

themeToggle?.addEventListener("click", () => {
  const nextTheme =
    document.documentElement.dataset.theme === "dark"
      ? "light"
      : "dark";

  applyTheme(nextTheme);

  try {
    localStorage.setItem("robotic-arm-theme", nextTheme);
  } catch {
    // The theme still changes for this page even if saving fails.
  }
});


/* =========================================================
   INITIALIZATION AND CLEANUP
   ========================================================= */

explainMicrophoneAvailability();

window.addEventListener("pagehide", () => {
  stopMicrophoneTracks();

  if (recordingUrl) {
    URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;
  }
});