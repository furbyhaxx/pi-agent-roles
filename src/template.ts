type Scope = {
	values: Record<string, unknown>;
	parent?: Scope;
};

type SectionKind = "each" | "if";

function isObjectLike(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function createScope(value: unknown, parent?: Scope, index?: number): Scope {
	const values = isObjectLike(value) ? { ...value } : {};
	values.this = value;
	if (index !== undefined) values["@index"] = index;
	return { values, parent };
}

function lookup(scope: Scope, path: string): unknown {
	const parts = path.split(".").filter(Boolean);
	if (parts.length === 0) return undefined;
	let value: unknown = undefined;
	for (let current: Scope | undefined = scope; current; current = current.parent) {
		if (Object.prototype.hasOwnProperty.call(current.values, parts[0]!)) {
			value = current.values[parts[0]!];
			break;
		}
	}
	for (const part of parts.slice(1)) {
		if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
		value = (value as Record<string, unknown>)[part];
	}
	return value;
}

function readSection(source: string, from: number, kind: SectionKind): { body: string; alternate: string; nextIndex: number } {
	const stack: SectionKind[] = [kind];
	let cursor = from;
	let elseStart = -1;
	let elseAfter = -1;
	while (cursor < source.length) {
		if (source.startsWith("\\{{", cursor)) {
			cursor += 3;
			continue;
		}
		if (!source.startsWith("{{", cursor)) {
			cursor += 1;
			continue;
		}
		const tagStart = cursor;
		const tagEnd = source.indexOf("}}", cursor + 2);
		if (tagEnd < 0) break;
		const tag = source.slice(cursor + 2, tagEnd).trim();
		cursor = tagEnd + 2;
		if (tag.startsWith("#each ")) stack.push("each");
		else if (tag.startsWith("#if ")) stack.push("if");
		else if (tag === "else" && kind === "if" && stack.length === 1 && elseStart < 0) {
			elseStart = tagStart;
			elseAfter = cursor;
		} else if ((tag === "/each" || tag === "/if") && stack.at(-1) === tag.slice(1)) {
			stack.pop();
			if (stack.length === 0) {
				return {
					body: source.slice(from, elseStart >= 0 ? elseStart : tagStart),
					alternate: elseStart >= 0 ? source.slice(elseAfter, tagStart) : "",
					nextIndex: cursor,
				};
			}
		}
	}
	return { body: source.slice(from), alternate: "", nextIndex: source.length };
}

function renderSegment(source: string, scope: Scope): string {
	let output = "";
	let index = 0;
	while (index < source.length) {
		if (source.startsWith("\\{{", index)) {
			output += "{{";
			index += 3;
			continue;
		}
		if (!source.startsWith("{{", index)) {
			output += source[index++]!;
			continue;
		}
		const tagEnd = source.indexOf("}}", index + 2);
		if (tagEnd < 0) {
			output += source.slice(index);
			break;
		}
		const tag = source.slice(index + 2, tagEnd).trim();
		index = tagEnd + 2;
		if (tag.startsWith("#each ")) {
			const section = readSection(source, index, "each");
			index = section.nextIndex;
			const items = lookup(scope, tag.slice(6).trim());
			if (Array.isArray(items)) {
				for (const [itemIndex, item] of items.entries()) {
					output += renderSegment(section.body, createScope(item, scope, itemIndex));
				}
			}
			continue;
		}
		if (tag.startsWith("#if ")) {
			const section = readSection(source, index, "if");
			index = section.nextIndex;
			output += renderSegment(lookup(scope, tag.slice(4).trim()) ? section.body : section.alternate, scope);
			continue;
		}
		if (tag === "else" || tag.startsWith("/")) continue;
		const value = lookup(scope, tag);
		output += value == null ? "" : String(value);
	}
	return output;
}

export function renderTemplate(template: string, values: Record<string, unknown>): string {
	return renderSegment(template, createScope(values));
}
