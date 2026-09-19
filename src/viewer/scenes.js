// Pure, DOM-free presentation ("Scenes") logic. presentation = { version: 1, scenes: [scene…] }.
// scene = { id, name, file, marks: [markKey…], step }. All functions are immutable:
// (presentation, …) → presentation.

function nextId(scenes) {
  let max = 0;
  for (const scene of scenes) {
    const m = /^s(\d+)$/.exec(scene.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `s${max + 1}`;
}

function replaceScene(presentation, id, fn) {
  return { ...presentation, scenes: presentation.scenes.map((s) => (s.id === id ? fn(s) : s)) };
}

export function addScene(presentation, { name, file = null, marks, step = null }) {
  const scene = { id: nextId(presentation.scenes), name, file, marks: [...marks], step };
  return { ...presentation, scenes: [...presentation.scenes, scene] };
}

export function duplicateScene(presentation, id) {
  const idx = presentation.scenes.findIndex((s) => s.id === id);
  if (idx === -1) return presentation;
  const source = presentation.scenes[idx];
  const copy = { ...source, id: nextId(presentation.scenes), name: `${source.name} copy`, marks: [...source.marks] };
  const scenes = [...presentation.scenes];
  scenes.splice(idx + 1, 0, copy);
  return { ...presentation, scenes };
}

export function moveScene(presentation, id, toIndex) {
  const scenes = [...presentation.scenes];
  const idx = scenes.findIndex((s) => s.id === id);
  if (idx === -1) return presentation;
  const [scene] = scenes.splice(idx, 1);
  const clamped = Math.max(0, Math.min(scenes.length, toIndex));
  scenes.splice(clamped, 0, scene);
  return { ...presentation, scenes };
}

export function renameScene(presentation, id, name) {
  return replaceScene(presentation, id, (s) => ({ ...s, name }));
}

export function updateScene(presentation, id, { file = null, marks, step = null }) {
  return replaceScene(presentation, id, (s) => ({ ...s, file, marks: [...marks], step }));
}

export function removeScene(presentation, id) {
  return { ...presentation, scenes: presentation.scenes.filter((s) => s.id !== id) };
}

// Next/previous scene id, wrapping; from "none active" (activeId === null) direction 1 goes to
// the first scene, direction -1 to the last. Returns null only when there are no scenes.
export function cycleScene(presentation, activeId, direction) {
  const { scenes } = presentation;
  if (scenes.length === 0) return null;
  const idx = activeId === null ? -1 : scenes.findIndex((s) => s.id === activeId);
  if (idx === -1) return direction > 0 ? scenes[0].id : scenes[scenes.length - 1].id;
  return scenes[(idx + direction + scenes.length) % scenes.length].id;
}

function knownMarkKeys(doc) {
  const known = new Set();
  for (const layer of doc.layers) {
    for (const mark of layer.marks) known.add(`${layer.id}|${mark.file}|${mark.start}|${mark.end}`);
  }
  return known;
}

// Parses + validates an imported presentation.json against doc's known marks. Throws on bad
// shape; drops mark keys that don't exist in doc and reports how many via `dropped`. Tolerates
// step: null and file: null (and missing).
export function parsePresentation(json, doc) {
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("presentation must be an object");
  if (json.version !== 1) throw new Error("unsupported presentation version");
  if (!Array.isArray(json.scenes)) throw new Error("presentation.scenes must be an array");

  const known = knownMarkKeys(doc);
  let dropped = 0;

  const scenes = json.scenes.map((s, i) => {
    if (!s || typeof s !== "object") throw new Error(`scene ${i} must be an object`);
    if (typeof s.id !== "string" || !s.id) throw new Error(`scene ${i} missing id`);
    if (typeof s.name !== "string" || !s.name) throw new Error(`scene ${i} missing name`);
    if (!Array.isArray(s.marks)) throw new Error(`scene ${i} marks must be an array`);
    if (s.file !== null && s.file !== undefined && typeof s.file !== "string") {
      throw new Error(`scene ${i} file must be a string or null`);
    }
    if (s.step !== null && s.step !== undefined && typeof s.step !== "number") {
      throw new Error(`scene ${i} step must be a number or null`);
    }

    const marks = [];
    for (const key of s.marks) {
      if (known.has(key)) marks.push(key);
      else dropped++;
    }

    return { id: s.id, name: s.name, file: s.file ?? null, marks, step: s.step ?? null };
  });

  return { presentation: { version: 1, scenes }, dropped };
}
