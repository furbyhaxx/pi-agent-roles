import assert from "node:assert/strict";
import { renderTemplate } from "../src/template.js";

function main(): void {
	assert.equal(renderTemplate("Hello {{name}}", { name: "Pi" }), "Hello Pi");
	assert.equal(
		renderTemplate("{{#each items}}- {{name}}\n{{/each}}", {
			items: [{ name: "a" }, { name: "b" }],
		}),
		"- a\n- b\n",
	);
	assert.equal(renderTemplate("{{#if flag}}on{{else}}off{{/if}}", { flag: false }), "off");
	assert.equal(renderTemplate("Hello {{missing}}", {}), "Hello ");
	assert.equal(renderTemplate("Value: {{value}}", { value: "<b>&</b>" }), "Value: <b>&</b>");
	console.log("template tests passed");
}

try {
	main();
} catch (error) {
	console.error(error);
	process.exitCode = 1;
}
