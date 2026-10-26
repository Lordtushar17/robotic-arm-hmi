/* =========================================================
   Saved poses section.
   ========================================================= */

import { $ } from "../../shared/dom.js";
import { apiRequest } from "../../shared/api.js";
import { state, setAngles, say, emit } from "../../shared/store.js";

const MAX_POSES = 50;

let savedPoses = [];
let posesLoading = false;

export function initPoses() {
  $("savePoseForm").addEventListener("submit", savePose);
  renderSavedPoses();
  refreshSavedPoses();
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
    say(`Could not load poses: ${error.message}`);
  } finally {
    posesLoading = false;
  }
}

function poseGlyph(poseAngles) {
  const glyph = document.createElement("span");
  glyph.className = "glyph";
  glyph.setAttribute("aria-hidden", "true");
  poseAngles.forEach((value) => {
    const bar = document.createElement("i");
    bar.style.setProperty("--v", (value / 180).toFixed(2));
    glyph.append(bar);
  });
  return glyph;
}

function renderSavedPoses() {
  const container = $("savedPoses");
  container.replaceChildren();
  $("poseCount").textContent = `${savedPoses.length} saved`;

  if (savedPoses.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = posesLoading
      ? "Loading saved poses…"
      : "No poses saved yet. Set the joints, name the pose, and save it.";
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
    values.textContent = pose.angles.join(" ");
    values.title = pose.angles.map((a, i) => `J${i + 1} ${a}°`).join(", ");
    info.append(name, values);

    const actions = document.createElement("div");
    actions.className = "saved-pose-actions";

    const loadButton = document.createElement("button");
    loadButton.className = "btn";
    loadButton.type = "button";
    loadButton.textContent = "Load";
    loadButton.addEventListener("click", () => loadPose(pose.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn";
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    let armed = null;
    deleteButton.addEventListener("click", () => {
      if (armed) {
        clearTimeout(armed);
        deletePose(pose.id);
        return;
      }
      deleteButton.textContent = "Confirm";
      deleteButton.classList.add("btn-danger");
      armed = setTimeout(() => {
        armed = null;
        deleteButton.textContent = "Delete";
        deleteButton.classList.remove("btn-danger");
      }, 3000);
    });

    actions.append(loadButton, deleteButton);
    card.append(poseGlyph(pose.angles), info, actions);
    container.append(card);
  });
}

async function savePose(event) {
  event.preventDefault();
  const name = $("poseName").value.trim();

  if (!name) {
    say("Enter a name for this pose.");
    return;
  }
  if (savedPoses.length >= MAX_POSES) {
    say("Pose limit reached. Delete a pose before saving another.");
    return;
  }
  if (savedPoses.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    say("A pose with that name already exists. Choose another name.");
    return;
  }

  const submitButton = $("savePoseForm").querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    await apiRequest("/api/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, angles: [...state.angles] })
    });
    await refreshSavedPoses();
    $("poseName").value = "";
    say(`Saved "${name}". Simulation only.`);
  } catch (error) {
    say(`Could not save pose: ${error.message}`);
  } finally {
    submitButton.disabled = false;
  }
}

function loadPose(id) {
  const pose = savedPoses.find((item) => item.id === id);
  if (!pose) return;
  
  // Set the angles in the store
  setAngles(pose.angles);
  
  // Tell the twin to snap its internal state so it animates from the current pose to the new one
  emit("twin:snap");
  
  say(`Loaded "${pose.name}". Press Apply positions to confirm. The physical arm did not move.`);
}

async function deletePose(id) {
  const pose = savedPoses.find((item) => item.id === id);
  if (!pose) return;
  try {
    await apiRequest(`/api/poses/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshSavedPoses();
    say(`Deleted "${pose.name}".`);
  } catch (error) {
    say(`Could not delete pose: ${error.message}`);
  }
}
