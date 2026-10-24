const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const POSES_FILE = path.join(DATA_DIR, "poses.json");

const MAX_BODY_SIZE = 16 * 1024;
const MAX_AUDIO_SIZE = 2 * 1024 * 1024; // 2 MB upload limit for short browser recordings
const MAX_POSES = 50;
const JOINT_COUNT = 6;
const MIN_ANGLE = 0;
const MAX_ANGLE = 180;
const WHISPER_TIMEOUT_MS = 90_000;
const FFMPEG_TIMEOUT_MS = 30_000;

// These defaults match the paths on the Raspberry Pi.
// Override them with environment variables if your paths differ.
const WHISPER_CLI =
  process.env.WHISPER_CLI ||
  "/home/robot/projects/whisper/whisper.cpp/build/bin/whisper-cli";
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  "/home/robot/projects/whisper/whisper.cpp/models/ggml-tiny.en.bin";
const FFMPEG_BIN = process.env.FFMPEG_BIN || "/usr/bin/ffmpeg";

let transcriptionBusy = false;

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(POSES_FILE)) {
  fs.writeFileSync(POSES_FILE, "[]\n", "utf8");
}

function sendJson(res, statusCode, data) {
  if (res.writableEnded || res.destroyed) return;

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function readPoses() {
  const poses = JSON.parse(fs.readFileSync(POSES_FILE, "utf8"));

  if (!Array.isArray(poses)) {
    throw new Error("Pose storage must contain a JSON array");
  }

  return poses;
}

function writePoses(poses) {
  const temporaryFile = `${POSES_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    `${JSON.stringify(poses, null, 2)}\n`,
    "utf8"
  );

  fs.renameSync(temporaryFile, POSES_FILE);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_SIZE) {
        tooLarge = true;
        body = "";
        return;
      }

      if (!tooLarge) body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
}

function readAudioBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_AUDIO_SIZE) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("AUDIO_TOO_LARGE"));
        return;
      }

      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

function runCommand(command, args, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let stderr = "";
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4000) {
        stderr += chunk.toString("utf8").slice(0, 4000 - stderr.length);
      }
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`${label}: ${error.message}`));
    });

    child.once("close", (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`${label}_TIMEOUT`));
      } else if (code !== 0) {
        console.error(`${label} exited with code ${code}:`, stderr);
        reject(new Error(`${label}_FAILED`));
      } else {
        resolve();
      }
    });
  });
}

function validatePose(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request must contain a JSON object";
  }

  if (typeof body.name !== "string") {
    return "Pose name must be text";
  }

  const name = body.name.trim();

  if (name.length < 1 || name.length > 40) {
    return "Pose name must contain 1–40 characters";
  }

  if (
    !Array.isArray(body.angles) ||
    body.angles.length !== JOINT_COUNT ||
    !body.angles.every(
      (angle) =>
        Number.isInteger(angle) &&
        angle >= MIN_ANGLE &&
        angle <= MAX_ANGLE
    )
  ) {
    return "Provide exactly six integer joint values from 0 to 180";
  }

  return null;
}

async function handleTranscribe(req, res) {
  const contentType = String(req.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  // MediaRecorder commonly produces WebM/Opus on Android/Chrome and MP4 on Safari.
  const allowedTypes = {
    "audio/webm": "webm",
    "audio/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  const inputExtension = allowedTypes[contentType];

  if (!inputExtension) {
    return sendJson(res, 415, {
      error: "Unsupported recording format. Please use a browser that records WebM or MP4 audio.",
    });
  }

  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > MAX_AUDIO_SIZE) {
    return sendJson(res, 413, { error: "Audio upload exceeds the 2 MB limit" });
  }

  if (transcriptionBusy) {
    return sendJson(res, 429, {
      error: "Another audio transcription is already running. Please try again shortly.",
    });
  }

  if (!fs.existsSync(FFMPEG_BIN) || !fs.statSync(FFMPEG_BIN).isFile()) {
    return sendJson(res, 503, {
      error: "FFmpeg was not found on the server",
    });
  }

  if (!fs.existsSync(WHISPER_CLI) || !fs.statSync(WHISPER_CLI).isFile()) {
    return sendJson(res, 503, {
      error: "Whisper executable was not found on the server",
    });
  }

  if (!fs.existsSync(WHISPER_MODEL) || !fs.statSync(WHISPER_MODEL).isFile()) {
    return sendJson(res, 503, {
      error: "Whisper English model was not found on the server",
    });
  }

  transcriptionBusy = true;
  let temporaryDirectory;

  try {
    const audioBuffer = await readAudioBody(req);

    if (audioBuffer.length === 0) {
      return sendJson(res, 400, { error: "The recording is empty" });
    }

    temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "robotic-arm-whisper-")
    );

    const inputPath = path.join(temporaryDirectory, `recording.${inputExtension}`);
    const wavPath = path.join(temporaryDirectory, "recording.wav");
    const outputBase = path.join(temporaryDirectory, "transcription");

    await fs.promises.writeFile(inputPath, audioBuffer, { flag: "wx" });

    // Convert browser-native recording to Whisper's preferred WAV format.
    await runCommand(
      FFMPEG_BIN,
      [
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-y",
        "-i", inputPath,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        wavPath,
      ],
      FFMPEG_TIMEOUT_MS,
      "FFMPEG"
    );

    const wavStats = await fs.promises.stat(wavPath);
    if (!wavStats.isFile() || wavStats.size < 44 || wavStats.size > 3 * 1024 * 1024) {
      throw new Error("CONVERTED_AUDIO_INVALID");
    }

    await runCommand(
      WHISPER_CLI,
      [
        "-m", WHISPER_MODEL,
        "-f", wavPath,
        "-t", "2",
        "-l", "en",
        "-nt",
        "-otxt",
        "-of", outputBase,
      ],
      WHISPER_TIMEOUT_MS,
      "WHISPER"
    );

    const transcriptPath = `${outputBase}.txt`;
    const transcript = (await fs.promises.readFile(transcriptPath, "utf8")).trim();

    return sendJson(res, 200, { transcript });
  } catch (error) {
    console.error("Transcription error:", error.message);

    if (error.message === "AUDIO_TOO_LARGE") {
      return sendJson(res, 413, { error: "Audio upload exceeds the 2 MB limit" });
    }

    if (error.message === "FFMPEG_TIMEOUT") {
      return sendJson(res, 504, { error: "Audio conversion timed out. Please try again." });
    }

    if (error.message === "FFMPEG_FAILED") {
      return sendJson(res, 400, {
        error: "The browser recording could not be decoded. Please record again.",
      });
    }

    if (error.message === "WHISPER_TIMEOUT") {
      return sendJson(res, 504, {
        error: "Speech recognition took too long. Please try a shorter recording.",
      });
    }

    if (error.message === "WHISPER_FAILED") {
      return sendJson(res, 500, { error: "Whisper could not transcribe this recording" });
    }

    if (error.message === "CONVERTED_AUDIO_INVALID") {
      return sendJson(res, 400, { error: "Converted audio was invalid or too large" });
    }

    return sendJson(res, 500, {
      error: "Unable to process audio. Please try recording again.",
    });
  } finally {
    transcriptionBusy = false;

    if (temporaryDirectory) {
      try {
        await fs.promises.rm(temporaryDirectory, {
          recursive: true,
          force: true,
        });
      } catch (error) {
        console.error("Unable to remove temporary audio files:", error.message);
      }
    }
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/status") {
    return sendJson(res, 200, {
      system: "online",
      arduino: "disconnected",
      camera: "not connected",
      mode: "simulation",
      joints: [90, 90, 90, 90, 90, 90, 90],
    });
  }

  if (req.method === "GET" && url.pathname === "/api/poses") {
    try {
      return sendJson(res, 200, { poses: readPoses() });
    } catch (error) {
      console.error("Unable to read pose storage:", error.message);
      return sendJson(res, 500, { error: "Unable to read saved poses" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/poses") {
    let body;

    try {
      body = await readRequestBody(req);
    } catch (error) {
      if (error.message === "BODY_TOO_LARGE") {
        return sendJson(res, 413, { error: "Request body is too large" });
      }

      if (error.message === "INVALID_JSON") {
        return sendJson(res, 400, { error: "Invalid JSON body" });
      }

      return sendJson(res, 400, { error: "Unable to read request body" });
    }

    const validationError = validatePose(body);

    if (validationError) {
      return sendJson(res, 400, { error: validationError });
    }

    try {
      const poses = readPoses();
      const name = body.name.trim();

      if (poses.length >= MAX_POSES) {
        return sendJson(res, 409, { error: "Pose limit reached" });
      }

      if (
        poses.some(
          (pose) =>
            typeof pose.name === "string" &&
            pose.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        return sendJson(res, 409, {
          error: "A pose with that name already exists",
        });
      }

      const pose = {
        id: randomUUID(),
        name,
        angles: [...body.angles],
      };

      poses.push(pose);
      writePoses(poses);

      return sendJson(res, 201, { pose });
    } catch (error) {
      console.error("Unable to save pose:", error.message);
      return sendJson(res, 500, { error: "Unable to save pose" });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/transcribe") {
    return handleTranscribe(req, res);
  }

  const deleteMatch = url.pathname.match(/^\/api\/poses\/([^/]+)$/);

  if (req.method === "DELETE" && deleteMatch) {
    let id;

    try {
      id = decodeURIComponent(deleteMatch[1]);
    } catch {
      return sendJson(res, 400, { error: "Invalid pose ID" });
    }

    try {
      const poses = readPoses();
      const updatedPoses = poses.filter((pose) => pose.id !== id);

      if (updatedPoses.length === poses.length) {
        return sendJson(res, 404, { error: "Pose not found" });
      }

      writePoses(updatedPoses);
      return sendJson(res, 200, { success: true });
    } catch (error) {
      console.error("Unable to delete pose:", error.message);
      return sendJson(res, 500, { error: "Unable to delete saved pose" });
    }
  }

  if (url.pathname.startsWith("/api/")) {
    return sendJson(res, 404, { error: "API endpoint not found" });
  }

  return null;
}

const server = http.createServer(async (req, res) => {
  let url;

  try {
    url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  } catch {
    return sendJson(res, 400, { error: "Invalid request URL" });
  }

  if (url.pathname.startsWith("/api/")) {
    try {
      const handled = await handleApi(req, res, url);
      if (handled !== null) return;
    } catch (error) {
      console.error("API error:", error.message);

      if (!res.headersSent) {
        return sendJson(res, 500, { error: "Internal server error" });
      }

      return res.destroy();
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Method not allowed" });
  }

  let requestedPath;

  try {
    requestedPath =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: "Invalid path" });
  }

  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);

  if (
    !filePath.startsWith(PUBLIC_DIR + path.sep) ||
    !fs.existsSync(filePath) ||
    !fs.statSync(filePath).isFile()
  ) {
    return sendJson(res, 404, { error: "Not found" });
  }

  const type =
    contentTypes[path.extname(filePath)] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });

  if (req.method === "HEAD") return res.end();

  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Robotic Arm HMI running at http://${HOST}:${PORT}`);
});
