import { classifyPrRisk } from '../classifier/risk-classifier.js';
import { REVIEW_VALIDATION_GATE } from './license-clean.js';
import { CURATED_SECURITY_SKILLS } from './registry.js';
import { renderSkillsForPrompt, selectSecuritySkills } from './selector.js';

export const SECURITY_SKILLS_MODES = ['all', 'auto'] as const;
export type SecuritySkillsMode = (typeof SECURITY_SKILLS_MODES)[number];

export interface SkillSelection {
	prompt: string;
	/** Skill domains included; `all` when nothing was filtered. */
	domains: string[];
	/** Characters saved against the full render (0 when nothing was filtered). */
	savedChars: number;
	fellBackToAll: boolean;
}

const DOC_EXTENSIONS = new Set(['md', 'mdx', 'txt', 'rst']);
const CODE_EXTENSIONS = new Set([
	'ts',
	'tsx',
	'js',
	'jsx',
	'mjs',
	'cjs',
	'py',
	'go',
	'rs',
	'java',
	'kt',
	'rb',
	'php',
	'cs',
	'swift',
	'c',
	'h',
	'cpp',
	'sql',
	'sh',
	'json',
	'yml',
	'yaml',
	'toml',
	'tf',
	'lock',
	'css',
	'html',
	'vue',
	'svelte',
	'gradle',
	'xml',
	'mod',
	'sum',
]);
const KNOWN_BASENAMES = new Set([
	'dockerfile',
	'jenkinsfile',
	'makefile',
	'pipfile',
	'license',
	'codeowners',
	'.gitignore',
	'.dockerignore',
	'.env',
]);

/** Classifier domains with no skill of their own, mapped to the closest one. */
const DOMAIN_ALIASES: Record<string, string> = {
	'process-execution': 'database-security', // injection skill covers command injection
	'cloud-infrastructure': 'cicd-security',
	serialization: 'file-handling', // upload and deserialization skill
};

type FileKind = 'doc' | 'code' | 'unknown';

function kindOf(filename: string): FileKind {
	const base = (filename.split('/').pop() ?? '').toLowerCase();
	if (KNOWN_BASENAMES.has(base) || base.startsWith('dockerfile.'))
		return 'code';
	const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
	if (DOC_EXTENSIONS.has(ext)) return 'doc';
	return CODE_EXTENSIONS.has(ext) ? 'code' : 'unknown';
}

/**
 * Chooses the security skills for the review prompt. `all` is exactly the
 * historical render. `auto` keeps only the skills for domains the existing
 * risk classifier flags, and always keeps the validation gate. Anything it
 * cannot classify (no files, truncated file list, unknown file type, classifier
 * error) returns the full render: it fails safe, never to nothing.
 */
export function selectReviewSecuritySkills(
	mode: SecuritySkillsMode,
	files: Array<{ filename: string; patch?: string }>,
	filesTruncated = false
): SkillSelection {
	const full = renderSkillsForPrompt(CURATED_SECURITY_SKILLS);
	const all: SkillSelection = {
		prompt: full,
		domains: CURATED_SECURITY_SKILLS.map((s) => s.domain),
		savedChars: 0,
		fellBackToAll: false,
	};
	if (mode === 'all') return all;
	const fallback = { ...all, fellBackToAll: true };
	if (files.length === 0 || filesTruncated) return fallback;
	const kinds = files.map((f) => kindOf(f.filename));
	if (kinds.includes('unknown')) return fallback;

	let prompt: string;
	let domains: string[];
	try {
		// Classify first: a flagged domain always wins over the docs shortcut.
		const flagged = classifyPrRisk(files).domains.map(
			(d) => DOMAIN_ALIASES[d] ?? d
		);
		if (flagged.length === 0 && kinds.every((k) => k === 'doc')) {
			// Prose only and nothing flagged: no domain skill, the gate still applies.
			domains = [];
			prompt = `\n## Targeted Security Review Knowledge\n${REVIEW_VALIDATION_GATE}\n`;
		} else {
			const skills = selectSecuritySkills(flagged);
			domains = skills.map((s) => s.domain);
			prompt = renderSkillsForPrompt(skills);
		}
	} catch {
		return fallback;
	}
	return {
		prompt,
		domains,
		savedChars: Math.max(0, full.length - prompt.length),
		fellBackToAll: false,
	};
}
