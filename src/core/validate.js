import { readFileSync } from "node:fs";
import { createValidator } from "./validate-core.js";

const schema = JSON.parse(
  readFileSync(new URL("../../schema/layers.schema.json", import.meta.url)),
);

export const validate = createValidator(schema);
