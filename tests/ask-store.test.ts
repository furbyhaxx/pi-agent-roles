import assert from "node:assert/strict";
import { createAskStore } from "../src/ask-store.js";

const store = createAskStore();
assert.equal(typeof store.isApproved, "function");
assert.equal(typeof store.approveTool, "function");
assert.equal(typeof store.approveToolArgs, "function");
assert.equal(typeof store.reset, "function");

store.approveTool("bash");
assert.equal(store.isApproved("bash", { command: "anything" }), true);

const argsStore = createAskStore();
argsStore.approveToolArgs("bash", { command: "ls" });
assert.equal(argsStore.isApproved("bash", { command: "ls" }), true);
assert.equal(argsStore.isApproved("bash", { command: "pwd" }), false);

const hashStore = createAskStore();
hashStore.approveToolArgs("bash", { a: 1, b: 2 });
assert.equal(hashStore.isApproved("bash", { b: 2, a: 1 }), true);

console.log("ask-store tests passed");
