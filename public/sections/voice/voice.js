/* =========================================================
   Voice input section.
   Records audio in the browser, uploads it to POST /api/transcribe,
   and shows the Whisper transcript.
   Transcription only: voice commands do NOT control the arm yet.
   ========================================================= */

import { $ } from "../../shared/dom.js";
import { apiRequest } from "../../shared/api.js";

// Looked up in initVoice(), after this section's HTML has been loaded.
let micPermissionBtn, talkBtn, micWrap, voiceStatus, recordingPreview, voiceWave;

let microphoneReady = false;
let activeRecorder = null;
let activeStream = null;
let recordedChunks = [];
let recordingUrl = null;
let transcriptionInProgress = false;
let recordTimer = null;
let autoStopTimer = null;
let audioCtx = null;
let meterFrame = null;
const commandHistory = [];

const MAX_RECORDING_SECONDS = 20;

function setMicState(state, label) {
  micWrap.dataset.state = state;
  $("talkLabel").textContent = label;
  talkBtn.setAttribute(
    "aria-label",
    state === "recording" ? "Stop recording" : "Record a voice command"
  );
}

function setVoiceStatus(message, options = {}) {
  voiceStatus.textContent = message;
  const isBusy = Boolean(options.busy);
  const feedback = $("voiceFeedback");
  feedback.setAttribute("aria-busy", String(isBusy));
  if (!isBusy && !activeRecorder) feedback.classList.remove("is-recording");
}

function formatClock(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function resetMeter() {
  cancelAnimationFrame(meterFrame);
  meterFrame = null;
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  [...voiceWave.children].forEach((bar) => bar.style.removeProperty("--h"));
}

function startMeter(stream) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const bars = [...voiceWave.children];

    const tick = () => {
      analyser.getByteFrequencyData(data);
      bars.forEach((bar, i) => {
        const v = data[1 + i * 2] / 255;
        bar.style.setProperty("--h", (0.12 + Math.min(1, v * 1.3) * 0.88).toFixed(2));
      });
      meterFrame = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    // The level meter is optional. Recording works without it.
  }
}

function stopMicrophoneTracks() {
  if (activeStream) {
    activeStream.getTracks().forEach((track) => track.stop());
    activeStream = null;
  }
}

function clearRecordingTimers() {
  clearInterval(recordTimer);
  clearTimeout(autoStopTimer);
  recordTimer = null;
  autoStopTimer = null;
}

function resetTalkButton() {
  resetMeter();
  clearRecordingTimers();
  $("voiceFeedback").classList.remove("is-recording");
  talkBtn.disabled = !microphoneReady || transcriptionInProgress;
  setMicState("idle", microphoneReady ? "Tap to talk" : "Enable microphone first");
}

function explainMicrophoneAvailability() {
  if (!window.isSecureContext) {
    setVoiceStatus("Microphone access needs HTTPS on a phone, or localhost on this device.");
    micPermissionBtn.disabled = true;
    talkBtn.disabled = true;
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setVoiceStatus("Microphone access is unavailable. Try an updated browser.");
    micPermissionBtn.disabled = true;
    talkBtn.disabled = true;
    return;
  }
  if (!window.MediaRecorder) {
    setVoiceStatus("This browser can use the microphone but cannot record audio.");
    talkBtn.disabled = true;
    return;
  }
  setVoiceStatus("Enable your microphone, then tap the button and speak.");
  micPermissionBtn.disabled = false;
  talkBtn.disabled = true;
}

function addTranscript(text) {
  commandHistory.unshift({ text, time: new Date() });
  commandHistory.length = Math.min(commandHistory.length, 4);

  $("transcriptBox").hidden = false;
  $("lastCommand").textContent = `“${text}”`;

  const log = $("commandLog");
  log.replaceChildren();
  commandHistory.slice(1).forEach((entry) => {
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const span = document.createElement("span");
    span.textContent = entry.text;
    li.append(time, span);
    log.append(li);
  });
}

async function sendAudioToWhisper(audioBlob) {
  transcriptionInProgress = true;
  talkBtn.disabled = true;
  micPermissionBtn.disabled = true;
  setMicState("processing", "Transcribing…");

  try {
    const uploadType = audioBlob.type || "audio/webm";

    setVoiceStatus(
      `Sending ${Math.max(1, Math.round(audioBlob.size / 1024))} KB to the Raspberry Pi for speech recognition…`,
      { busy: true }
    );

    const data = await apiRequest("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": uploadType },
      body: audioBlob
    });

    if (typeof data.transcript !== "string" || !data.transcript.trim()) {
      throw new Error("Whisper returned an empty transcription.");
    }

    const text = data.transcript.trim();
    addTranscript(text);
    setVoiceStatus("Done. Check the transcript below.");
  } catch (error) {
    setVoiceStatus(
      `Transcription failed: ${error.message}. Check the Raspberry Pi server and try a shorter recording.`
    );
  } finally {
    transcriptionInProgress = false;
    micPermissionBtn.disabled = false;
    resetTalkButton();
  }
}

async function onMicPermissionClick() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    explainMicrophoneAvailability();
    return;
  }

  micPermissionBtn.disabled = true;
  setVoiceStatus("Requesting microphone permission…");

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    microphoneReady = true;
    stopMicrophoneTracks();

    micPermissionBtn.hidden = true;
    resetTalkButton();
    setVoiceStatus("Microphone ready. Tap the button, speak in English, then tap again to stop.");
  } catch (error) {
    microphoneReady = false;
    talkBtn.disabled = true;
    micPermissionBtn.disabled = false;
    setVoiceStatus(`Could not access the microphone: ${error.message || error.name}`);
  }
}

async function onTalkClick() {
  if (activeRecorder?.state === "recording") {
    activeRecorder.stop();
    talkBtn.disabled = true;
    setVoiceStatus("Finishing recording…");
    return;
  }

  if (!microphoneReady || transcriptionInProgress) return;

  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    explainMicrophoneAvailability();
    return;
  }

  try {
    activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];

    const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    const mimeType = supportedTypes.find((type) => MediaRecorder.isTypeSupported(type));

    activeRecorder = mimeType
      ? new MediaRecorder(activeStream, { mimeType })
      : new MediaRecorder(activeStream);

    const recorder = activeRecorder;
    const startedAt = Date.now();

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size > 0) recordedChunks.push(event.data);
    });

    recorder.addEventListener(
      "stop",
      async () => {
        const actualType = recorder.mimeType || "audio/webm";
        const audioBlob = new Blob(recordedChunks, { type: actualType });
        const durationSeconds = (Date.now() - startedAt) / 1000;

        activeRecorder = null;
        stopMicrophoneTracks();
        resetMeter();
        clearRecordingTimers();

        if (audioBlob.size === 0) {
          resetTalkButton();
          setVoiceStatus("No audio was recorded. Please try again.");
          return;
        }

        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        recordingUrl = URL.createObjectURL(audioBlob);
        recordingPreview.src = recordingUrl;
        recordingPreview.hidden = false;

        if (durationSeconds > MAX_RECORDING_SECONDS + 2) {
          resetTalkButton();
          setVoiceStatus(
            `Recording was ${Math.ceil(durationSeconds)} seconds. Keep commands under ${MAX_RECORDING_SECONDS} seconds.`
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
        activeRecorder = null;
        stopMicrophoneTracks();
        resetTalkButton();
        setVoiceStatus(`Recording failed: ${event.error?.message || "browser recorder error"}`);
      },
      { once: true }
    );

    recorder.start();
    startMeter(activeStream);

    setMicState("recording", "Tap to stop");
    $("voiceFeedback").classList.add("is-recording");
    setVoiceStatus("Listening. Speak your English command.");

    $("voiceTimer").textContent = `0:00 / ${formatClock(MAX_RECORDING_SECONDS)}`;
    recordTimer = setInterval(() => {
      $("voiceTimer").textContent =
        `${formatClock((Date.now() - startedAt) / 1000)} / ${formatClock(MAX_RECORDING_SECONDS)}`;
    }, 250);

    // Stop automatically just before the limit instead of rejecting a long clip afterwards.
    autoStopTimer = setTimeout(() => {
      if (recorder.state === "recording") {
        setVoiceStatus(`Reached the ${MAX_RECORDING_SECONDS} second limit. Sending what was recorded…`);
        recorder.stop();
        talkBtn.disabled = true;
      }
    }, (MAX_RECORDING_SECONDS - 0.5) * 1000);
  } catch (error) {
    activeRecorder = null;
    stopMicrophoneTracks();
    resetTalkButton();
    setVoiceStatus(`Could not start recording: ${error.message || error.name}`);
  }
}

export function initVoice() {
  micPermissionBtn = $("micPermissionBtn");
  talkBtn = $("talkBtn");
  micWrap = $("micWrap");
  voiceStatus = $("voiceStatus");
  recordingPreview = $("recordingPreview");
  voiceWave = $("voiceWave");

  micPermissionBtn.addEventListener("click", onMicPermissionClick);
  talkBtn.addEventListener("click", onTalkClick);

  explainMicrophoneAvailability();
  resetTalkButton();

  window.addEventListener("pagehide", () => {
    stopMicrophoneTracks();
    resetMeter();
    if (recordingUrl) {
      URL.revokeObjectURL(recordingUrl);
      recordingUrl = null;
    }
  });
}
