import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = resolve(__dirname, '..');
const read = (file: string): string =>
	readFileSync(resolve(root, file), 'utf8');

const skillPath = '.claude/skills/weekly-research/SKILL.md';
const skill = read(skillPath);

const frontmatter = (): Record<string, string> => {
	const match = skill.match(/^---\n([\s\S]*?)\n---\n/);
	expect(match, 'frontmatter block').not.toBeNull();
	return parse(match?.[1] ?? '') as Record<string, string>;
};

describe('weekly-research skill', () => {
	it('declares a matching name and a trigger-rich description', () => {
		const fm = frontmatter();
		expect(fm.name).toBe('weekly-research');
		expect(fm.description.length).toBeGreaterThan(80);
		expect(fm.description).toMatch(/weekly/i);
	});

	it('covers the three research sources', () => {
		expect(skill).toContain('goodailist.com');
		expect(skill).toMatch(/gh search repos/);
		expect(skill).toMatch(/Hacker News/);
	});

	it('caps concurrency at three agents', () => {
		expect(skill).toMatch(/At most \*\*3 agents at the same time\*\*/);
		expect(skill).toMatch(/three scouts/i);
	});

	it('treats fetched content as untrusted and keeps scouts read-only', () => {
		expect(skill).toMatch(/untrusted data/);
		expect(skill).toMatch(/read-only/);
	});

	it('runs plan, implement, test, and PR phases and never merges', () => {
		for (const phase of ['Plan', 'Implement', 'Test', 'Pull request']) {
			expect(skill).toMatch(new RegExp(`## Phase \\d: ${phase}`));
		}
		expect(skill).toMatch(/Never merge/);
		for (const gate of ['pnpm lint', 'pnpm typecheck', 'pnpm test']) {
			expect(skill).toContain(gate);
		}
	});

	it('only builds within the product-intelligence constraints', () => {
		expect(skill).toContain('.product-intelligence/CONSTRAINTS.md');
		expect(skill).toMatch(/no new runtime dependency/i);
	});

	it('references files that exist', () => {
		const refs = [
			'.claude/agents/researcher.md',
			'.product-intelligence/CONSTRAINTS.md',
			'.product-intelligence/PRODUCT.md',
			'.product-intelligence/state.json',
			'docs/index.md',
			'CLAUDE.md',
			'biome.json',
		];
		for (const ref of refs) {
			expect(skill, ref).toContain(ref);
			expect(existsSync(resolve(root, ref)), ref).toBe(true);
		}
	});

	it('contains no AI attribution, model names, or em dashes', () => {
		expect(skill).not.toMatch(/co-authored-by:\s*\S/i);
		expect(skill).not.toMatch(/generated (with|by)\s+(claude|ai)/i);
		expect(skill).not.toContain('—');
	});

	it('is registered in the docs index', () => {
		expect(read('docs/index.md')).toContain('weekly-research');
	});
});
