/* =========================================================
   Shared state + tiny event bus.

   Sections never touch each other's HTML. They talk through here:

     state.angles    what the sliders show right now
     state.applied   last pose confirmed with "Apply positions"

   Events you can listen to with on("name", fn):
     angles          joint angles changed (slider, pose load, reset)
     applied         the applied pose changed
     message         text for the joint panel's feedback line
     joint:active    a joint row gained/lost focus (index or null)
     status          server status text for the footer
   ========================================================= */

export const DEFAULT_ANGLES = [90, 90, 90, 90, 90, 90];

export const state = {
  angles: [...DEFAULT_ANGLES],
  applied: [...DEFAULT_ANGLES]
};

const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
}

export function emit(name, detail) {
  handlers.get(name)?.forEach((fn) => fn(detail));
}

export const sameAngles = (a, b) => a.every((v, i) => v === b[i]);
export const isPending = () => !sameAngles(state.angles, state.applied);

export function setAngle(index, value) {
  state.angles[index] = Math.min(180, Math.max(0, Math.round(value)));
  emit("angles");
}

export function setAngles(next) {
  state.angles = [...next];
  emit("angles");
}

export function applyAngles() {
  state.applied = [...state.angles];
  emit("applied");
}

export function resetAngles() {
  state.angles = [...DEFAULT_ANGLES];
  state.applied = [...DEFAULT_ANGLES];
  emit("angles");
  emit("applied");
}

export const say = (text) => emit("message", text);
