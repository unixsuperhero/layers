import { readFileSync } from "node:fs";
import Ajv from "ajv";

const schema = JSON.parse(
  readFileSync(new URL("../../schema/layers.schema.json", import.meta.url)),
);

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

export function validate(doc) {
  if (!validateSchema(doc)) {
    return {
      ok: false,
      errors: validateSchema.errors.map((e) => ({
        path: e.instancePath,
        message: e.message,
      })),
    };
  }

  const errors = [];

  for (const [i, layer] of doc.layers.entries()) {
    layer.marks.forEach((mark, j) => {
      checkFileRef(errors, `/layers/${i}/marks/${j}`, doc, mark);
    });
  }
  (doc.trace ?? []).forEach((event, i) => {
    checkFileRef(errors, `/trace/${i}`, doc, event);
  });

  (doc.trace ?? []).forEach((event, i) => {
    if (event.i !== i) {
      errors.push({ path: `/trace/${i}/i`, message: `expected i === ${i}, got ${event.i}` });
    }
  });

  const seenIds = new Map();
  doc.layers.forEach((layer, i) => {
    if (seenIds.has(layer.id)) {
      errors.push({
        path: `/layers/${i}/id`,
        message: `duplicate layer id "${layer.id}" (also at /layers/${seenIds.get(layer.id)})`,
      });
    } else {
      seenIds.set(layer.id, i);
    }
  });
  for (let i = 1; i < doc.layers.length; i++) {
    if (doc.layers[i - 1].id >= doc.layers[i].id) {
      errors.push({
        path: `/layers/${i}/id`,
        message: `layers must be sorted by id ("${doc.layers[i - 1].id}" before "${doc.layers[i].id}")`,
      });
    }
  }

  doc.layers.forEach((layer, i) => {
    for (let j = 1; j < layer.marks.length; j++) {
      if (compareMarks(layer.marks[j - 1], layer.marks[j]) > 0) {
        errors.push({
          path: `/layers/${i}/marks/${j}`,
          message: "marks must be sorted by (file, start, end, symbol)",
        });
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

function compareMarks(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.start !== b.start) return a.start - b.start;
  if (a.end !== b.end) return a.end - b.end;
  const as = a.symbol ?? "";
  const bs = b.symbol ?? "";
  if (as !== bs) return as < bs ? -1 : 1;
  return 0;
}

function checkFileRef(errors, path, doc, item) {
  const fileInfo = doc.files[item.file];
  if (!fileInfo) {
    errors.push({ path: `${path}/file`, message: `unknown file "${item.file}"` });
    return;
  }
  if (!(item.start <= item.end && item.end <= fileInfo.bytes)) {
    errors.push({
      path,
      message: `expected start <= end <= bytes (${item.start} <= ${item.end} <= ${fileInfo.bytes})`,
    });
  }
}

