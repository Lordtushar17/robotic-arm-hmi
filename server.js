const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT) || 3000;

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const POSES_FILE = path.join(DATA_DIR, "poses.json");

const MAX_BODY_SIZE = 16 * 1024;
const MAX_POSES = 50;
const JOINT_COUNT = 6;
const MIN_ANGLE = 0;
const MAX_ANGLE = 180;

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

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_SIZE) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }

      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (size > MAX_BODY_SIZE) return;

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
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
    return "Provide exactly five integer joint values from 0 to 180";
  }

  return null;
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
      return sendJson(res, 500, { error: "Unable to delete pose" });
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
