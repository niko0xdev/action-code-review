import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandDeep } from './canaries.js';

const FIXTURE_ROOT = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'fixtures'
);

/** Patch used when a case only attacks PR metadata. Line 2 is added. */
export const BENIGN_PATCH =
	'@@ -1,3 +1,4 @@\n const a = 1;\n+const b = 2;\n const c = 3;\n export { a, c };';

export interface FixtureFile {
	filename: string;
	status?: 'added' | 'modified' | 'removed' | 'renamed';
	patch?: string;
}

export interface InjectionCase {
	id: string;
	/** Garak-style probe family the case belongs to. */
	category: string;
	/** Where the hostile text enters the pipeline. */
	surface:
		| 'title'
		| 'body'
		| 'hunk'
		| 'filename'
		| 'comment'
		| 'commit'
		| 'model-output';
	description: string;
	pr: { title: string; body: string };
	files: Required<FixtureFile>[];
	/** Text GitHub delivers next to the PR that never belongs in the prompt. */
	sideChannels: { comments: string[]; commits: string[] };
	/** Canned model response, as a compromised model might emit it. */
	modelOutput?: string;
	/** `[path, line]` anchors the validator is expected to keep. */
	accepted: Array<[string, number]>;
	/** Strings that must never appear verbatim in anything sent to GitHub. */
	forbiddenOutbound: string[];
	/** Strip zero-width characters from outbound text before checking. */
	stripInvisible: boolean;
	/** Property name to a precise description of a real pipeline defect. */
	knownDefects: Record<string, string>;
}

interface RawInjectionCase {
	id: string;
	category: string;
	surface: InjectionCase['surface'];
	description: string;
	pr?: Partial<InjectionCase['pr']>;
	files?: FixtureFile[];
	sideChannels?: Partial<InjectionCase['sideChannels']>;
	modelOutput?: unknown;
	accepted?: Array<[string, number]>;
	forbiddenOutbound?: string[];
	stripInvisible?: boolean;
	knownDefects?: Record<string, string>;
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Load every `fixtures/injection/*.json` file, expanding canary placeholders. */
export function loadInjectionCases(): InjectionCase[] {
	const dir = join(FIXTURE_ROOT, 'injection');
	const cases: InjectionCase[] = [];
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith('.json')) continue;
		const file = readJson<{ cases: RawInjectionCase[] }>(join(dir, name));
		for (const raw of file.cases) {
			const expanded = expandDeep(raw);
			cases.push({
				id: expanded.id,
				category: expanded.category,
				surface: expanded.surface,
				description: expanded.description,
				pr: {
					title: expanded.pr?.title ?? 'Tidy constants',
					body: expanded.pr?.body ?? '',
				},
				files: (expanded.files ?? [{ filename: 'src/app.ts' }]).map((f) => ({
					filename: f.filename,
					status: f.status ?? 'modified',
					patch: f.patch ?? BENIGN_PATCH,
				})),
				sideChannels: {
					comments: expanded.sideChannels?.comments ?? [],
					commits: expanded.sideChannels?.commits ?? [],
				},
				...(expanded.modelOutput === undefined
					? {}
					: {
							modelOutput:
								typeof expanded.modelOutput === 'string'
									? expanded.modelOutput
									: JSON.stringify(expanded.modelOutput),
						}),
				accepted: expanded.accepted ?? [],
				forbiddenOutbound: expanded.forbiddenOutbound ?? [],
				stripInvisible: expanded.stripInvisible ?? false,
				knownDefects: expanded.knownDefects ?? {},
			});
		}
	}
	return cases;
}

export interface StubbedScenario {
	id: string;
	description: string;
	/** Is the PR genuinely free of defects? Drives the false-block rate. */
	cleanPr: boolean;
	files: Required<FixtureFile>[];
	/** Seeded defects the model should find (anchor in the new file). */
	seededDefects: Array<{ id: string; path: string; line: number }>;
	modelOutput: string;
	/** Raw reply of the stubbed verify pass, when the scenario enables it. */
	verifyOutput?: string;
	minSeverity?: string;
	/** `[path, line]` anchors expected to be published. */
	published: Array<[string, number]>;
	blocked: boolean;
}

interface RawScenario extends Omit<StubbedScenario, 'files' | 'modelOutput'> {
	files?: FixtureFile[];
	modelOutput: unknown;
}

export function loadStubbedScenarios(): StubbedScenario[] {
	const file = readJson<{ scenarios: RawScenario[] }>(
		join(FIXTURE_ROOT, 'stubbed', 'false-positives.json')
	);
	return file.scenarios.map((raw) => ({
		...raw,
		files: (raw.files ?? [{ filename: 'src/app.ts' }]).map((f) => ({
			filename: f.filename,
			status: f.status ?? 'modified',
			patch: f.patch ?? BENIGN_PATCH,
		})),
		modelOutput:
			typeof raw.modelOutput === 'string'
				? raw.modelOutput
				: JSON.stringify(raw.modelOutput),
	}));
}

export type FaultKind =
	| 'api-failure'
	| 'schema-refusal'
	| 'truncated-diff'
	| 'group-failure'
	| 'verify-error'
	| 'verify-malformed'
	| 'pagination-truncated'
	| 'stale-head'
	| 'stale-head-recheck-error';

export interface IncompleteScenario {
	id: string;
	description: string;
	fault: FaultKind;
	files: Required<FixtureFile>[];
	/** Raw model reply for faults that depend on one. */
	modelOutput?: string;
	maxContextChars?: number;
	/** Property name to a precise description of a real pipeline defect. */
	knownDefects: Record<string, string>;
}

interface RawIncomplete
	extends Omit<IncompleteScenario, 'files' | 'knownDefects'> {
	files?: FixtureFile[];
	knownDefects?: Record<string, string>;
}

export function loadIncompleteScenarios(): IncompleteScenario[] {
	const file = readJson<{ scenarios: RawIncomplete[] }>(
		join(FIXTURE_ROOT, 'stubbed', 'incomplete-reviews.json')
	);
	return file.scenarios.map((raw) => ({
		...raw,
		files: (raw.files ?? [{ filename: 'src/app.ts' }]).map((f) => ({
			filename: f.filename,
			status: f.status ?? 'modified',
			patch: f.patch ?? BENIGN_PATCH,
		})),
		knownDefects: raw.knownDefects ?? {},
	}));
}
