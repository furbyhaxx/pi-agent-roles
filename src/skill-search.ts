import { parseFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const TOKEN_SPLIT_PATTERN = /[^A-Za-z0-9]+/;
const LINE_REFERENCE_PATTERN = /^\s*(?:Run|Read|read):\s*([^\s]+)/gm;
const INLINE_REFERENCE_PATTERN = /<read>(\S+)<\/read>/g;
const BARE_READ_REFERENCE_PATTERN = /\bread\s+(\.\.?\/\S+|\/\S+)/g;
const MAX_REFERENCE_COUNT = 10;
const BM25_K1 = 1.5;
const BM25_B = 0.75;
const SNIPPET_LENGTH = 200;

const rawFileCache = new Map<string, string>();
const skillBodyCache = new Map<string, string>();
const referenceCorpusCache = new Map<string, string>();

type SearchableSkill = Pick<Skill, "name" | "description" | "filePath">;

type IndexedDocument = {
	skill: SearchableSkill;
	corpus: string;
	displayText: string;
	length: number;
	frequencies: Map<string, number>;
};

export type SkillSearchHit = {
	name: string;
	snippet: string;
	score: number;
};

export type SkillSearchIndex = {
	size: number;
	search(query: string, options?: { limit?: number }): SkillSearchHit[];
};

export type CreateSkillSearchIndexOptions = {
	filter?: (skill: SearchableSkill) => boolean;
};

function tokenize(input: string): string[] {
	return input
		.toLowerCase()
		.split(TOKEN_SPLIT_PATTERN)
		.filter((token) => token.length >= 2);
}

function normalizeWhitespace(input: string): string {
	return input.replace(/\s+/g, " ").trim();
}

function readTextCached(path: string): string {
	const cacheKey = isAbsolute(path) ? path : resolve(path);
	const cached = rawFileCache.get(cacheKey);
	if (cached !== undefined) return cached;
	try {
		const value = readFileSync(cacheKey, "utf8");
		rawFileCache.set(cacheKey, value);
		return value;
	} catch {
		rawFileCache.set(cacheKey, "");
		return "";
	}
}

function getSkillBody(filePath: string): string {
	const cacheKey = resolve(filePath);
	const cached = skillBodyCache.get(cacheKey);
	if (cached !== undefined) return cached;
	const raw = readTextCached(cacheKey);
	const body = parseFrontmatter(raw).body.trim();
	skillBodyCache.set(cacheKey, body);
	return body;
}

function pushReference(target: string[], seen: Set<string>, skillPath: string, reference: string): void {
	if (target.length >= MAX_REFERENCE_COUNT) return;
	const resolvedReference = isAbsolute(reference) ? reference : resolve(dirname(skillPath), reference);
	if (seen.has(resolvedReference)) return;
	seen.add(resolvedReference);
	target.push(resolvedReference);
}

function collectReferenceMatches(pattern: RegExp, body: string, skillPath: string, target: string[], seen: Set<string>): void {
	pattern.lastIndex = 0;
	let match = pattern.exec(body);
	while (match && target.length < MAX_REFERENCE_COUNT) {
		const reference = match[1]?.trim();
		if (reference) pushReference(target, seen, skillPath, reference);
		match = pattern.exec(body);
	}
}

function getReferencedCorpus(skillPath: string): string {
	const cacheKey = resolve(skillPath);
	const cached = referenceCorpusCache.get(cacheKey);
	if (cached !== undefined) return cached;
	const body = getSkillBody(cacheKey);
	const references: string[] = [];
	const seen = new Set<string>();
	collectReferenceMatches(LINE_REFERENCE_PATTERN, body, cacheKey, references, seen);
	collectReferenceMatches(INLINE_REFERENCE_PATTERN, body, cacheKey, references, seen);
	collectReferenceMatches(BARE_READ_REFERENCE_PATTERN, body, cacheKey, references, seen);
	const corpus = references
		.map((referencePath) => normalizeWhitespace(readTextCached(referencePath)))
		.filter((text) => text.length > 0)
		.join("\n");
	referenceCorpusCache.set(cacheKey, corpus);
	return corpus;
}

function buildDocument(skill: SearchableSkill): IndexedDocument {
	const body = getSkillBody(skill.filePath);
	const referencedCorpus = getReferencedCorpus(skill.filePath);
	const corpus = [skill.name, skill.description, body, referencedCorpus]
		.filter((part) => part.trim() !== "")
		.join("\n\n");
	const tokens = tokenize(corpus);
	const frequencies = new Map<string, number>();
	for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
	return {
		skill,
		corpus,
		displayText: normalizeWhitespace(corpus),
		length: tokens.length,
		frequencies,
	};
}

function idf(documentCount: number, frequency: number): number {
	return Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
}

function uniqueQueryTerms(query: string): string[] {
	return [...new Set(tokenize(query))];
}

function createSnippet(text: string, queryTerms: readonly string[], bestTerm: string): string {
	if (text.length <= SNIPPET_LENGTH) return text;
	const lowerText = text.toLowerCase();
	const orderedTerms = [bestTerm, ...queryTerms.filter((term) => term !== bestTerm)].filter((term) => term.length > 0);
	let matchIndex = -1;
	for (const term of orderedTerms) {
		matchIndex = lowerText.indexOf(term.toLowerCase());
		if (matchIndex !== -1) break;
	}
	if (matchIndex === -1) return `${text.slice(0, SNIPPET_LENGTH).trim()}…`;
	let start = Math.max(0, matchIndex - Math.floor(SNIPPET_LENGTH / 2));
	let end = Math.min(text.length, start + SNIPPET_LENGTH);
	start = Math.max(0, end - SNIPPET_LENGTH);
	let snippet = text.slice(start, end).trim();
	if (start > 0) snippet = `…${snippet}`;
	if (end < text.length) snippet = `${snippet}…`;
	return snippet;
}

export function createSkillSearchIndex(
	skills: readonly SearchableSkill[],
	options: CreateSkillSearchIndexOptions = {},
): SkillSearchIndex {
	const filteredSkills = options.filter ? skills.filter((skill) => options.filter?.(skill)) : [...skills];
	const documents = filteredSkills.map(buildDocument);
	const documentFrequencies = new Map<string, number>();
	for (const document of documents) {
		for (const token of document.frequencies.keys()) {
			documentFrequencies.set(token, (documentFrequencies.get(token) ?? 0) + 1);
		}
	}
	const averageDocumentLength = documents.length > 0
		? documents.reduce((sum, document) => sum + document.length, 0) / documents.length
		: 0;

	return {
		size: documents.length,
		search(query: string, searchOptions?: { limit?: number }): SkillSearchHit[] {
			const queryTerms = uniqueQueryTerms(query);
			if (queryTerms.length === 0 || documents.length === 0) return [];
			const limit = Math.max(0, searchOptions?.limit ?? 5);
			if (limit === 0) return [];
			const avgdl = averageDocumentLength > 0 ? averageDocumentLength : 1;
			const hits = documents.flatMap((document) => {
				let score = 0;
				let bestTerm = "";
				let bestContribution = 0;
				for (const term of queryTerms) {
					const tf = document.frequencies.get(term) ?? 0;
					if (tf === 0) continue;
					const df = documentFrequencies.get(term) ?? 0;
					if (df === 0) continue;
					const numerator = tf * (BM25_K1 + 1);
					const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (document.length / avgdl));
					const contribution = idf(documents.length, df) * (numerator / denominator);
					score += contribution;
					if (contribution > bestContribution) {
						bestContribution = contribution;
						bestTerm = term;
					}
				}
				if (score <= 0) return [];
				return [{
					name: document.skill.name,
					snippet: createSnippet(document.displayText, queryTerms, bestTerm),
					score,
				}];
			});
			return hits
				.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
				.slice(0, limit);
		},
	};
}
