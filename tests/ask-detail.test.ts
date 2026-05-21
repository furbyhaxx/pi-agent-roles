import assert from "node:assert/strict";
import type { LoadedAskConfig } from "../src/config.js";
import { flattenInput, formatDetail, getByPath } from "../src/ask-detail.js";

const askConfig: LoadedAskConfig = {
	primaryToolArgs: {
		bash: "command",
		write: "path",
		custom: "payload.target",
	},
	sources: [],
};

assert.equal(formatDetail("bash", { command: "rm -rf tmp" }, askConfig), "bash rm -rf tmp");
assert.equal(formatDetail("write", { path: "foo.log", content: "…" }, askConfig), "write foo.log");

const truncated = formatDetail("bash", { command: "x".repeat(300) }, askConfig);
assert.equal(truncated.length, 240);
assert.ok(truncated.endsWith("…"));

assert.equal(formatDetail("custom", { payload: {} }, askConfig), "");
assert.deepEqual(flattenInput({ a: { b: 1 }, c: "x" }), [["a.b", "1"], ["c", '"x"']]);
assert.equal(getByPath({ payload: { target: "value" } }, "payload.target"), "value");
assert.equal(getByPath({ payload: { target: "value" } }, "payload.missing"), undefined);

console.log("ask-detail tests passed");
