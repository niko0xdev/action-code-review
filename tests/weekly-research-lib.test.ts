import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
	dedupeByUrl,
	dropCovered,
	licenceFlag,
	normaliseItem,
	parseModelJson,
	rankByPriority,
	renderReport,
	safeUrl,
	sanitiseText,
	ukDate,
	validateRanked,
} from '../scripts/weekly-research/lib.mjs';

const root = resolve(__dirname, '..');
const workflow = parse(
	readFileSync(resolve(root, '.github/workflows/weekly-research.yml'), 'utf8')
) as Record<string, any>;

describe('weekly-research helpers', () => {
	it('neutralises markup, mentions, and control characters', () => {
		const out = sanitiseText('Hi @octocat <img src=x> `rm -rf`\u0000| ok');
		expect(out).not.toMatch(/[<>`|@]/);
		expect(out.includes('\u0000')).toBe(false);
		expect(out).toContain('(at)octocat');
	});

	it('truncates long text', () => {
		expect(sanitiseText('a'.repeat(500), 50)).toHaveLength(50);
	});

	it('accepts only http(s) URLs', () => {
		expect(safeUrl('https://github.com/a/b')).toBe('https://github.com/a/b');
		expect(safeUrl('javascript:alert(1)')).toBe('');
		expect(safeUrl('not a url')).toBe('');
	});

	it('normalises items and drops those without a usable URL', () => {
		expect(normaliseItem({ name: 'x', url: 'ftp://x' }, 'web')).toBeNull();
		expect(
			normaliseItem({ name: 'x', url: 'https://a.io/x', stars: '12' }, 'web')
		).toMatchObject({ stars: 12, source: 'web' });
	});

	it('dedupes by URL ignoring case and trailing slash', () => {
		const items = [
			{ url: 'https://github.com/A/b/' },
			{ url: 'https://github.com/a/b' },
			{ url: 'https://github.com/c/d' },
		];
		expect(dedupeByUrl(items)).toHaveLength(2);
	});

	it('drops candidates already covered by earlier research', () => {
		const items = [
			{ url: 'https://github.com/alibaba/open-code-review' },
			{ url: 'https://github.com/new/thing' },
		];
		const kept = dropCovered(items, 'see alibaba/open-code-review teardown');
		expect(kept.map((i) => i.url)).toEqual(['https://github.com/new/thing']);
	});

	it('classifies licences', () => {
		expect(licenceFlag('MIT')).toBe('permissive');
		expect(licenceFlag('GPL-3.0')).toBe('review');
		expect(licenceFlag(null)).toBe('unknown');
	});

	it('extracts JSON from chatty model output', () => {
		expect(parseModelJson('Sure!\n[{"a":1}]\nDone')).toEqual([{ a: 1 }]);
		expect(() => parseModelJson('no json here')).toThrow();
	});

	it('keeps only model rows whose URL was collected and clamps scores', () => {
		const rows = validateRanked(
			[
				{
					name: 'ok',
					url: 'https://github.com/a/b',
					impact: 9,
					fit: 0,
					effort: 3,
				},
				{
					name: 'invented',
					url: 'https://github.com/x/y',
					impact: 5,
					fit: 5,
					effort: 5,
				},
				{ name: 'bad', url: 'javascript:1', impact: 5, fit: 5, effort: 5 },
			],
			['https://github.com/a/b']
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			impact: 5,
			fit: 1,
			effort: 3,
			priority: 15,
			adoption_mode: 'reference',
		});
		expect(validateRanked('nope', [])).toEqual([]);
	});

	it('ranks by priority then name', () => {
		const sorted = rankByPriority([
			{ name: 'b', priority: 10 },
			{ name: 'a', priority: 10 },
			{ name: 'c', priority: 50 },
		]);
		expect(sorted.map((r) => r.name)).toEqual(['c', 'a', 'b']);
	});

	it('renders a British-English report without em dashes or pipes in cells', () => {
		const md = renderReport({
			date: '2026-11-16',
			scoutsRun: ['github'],
			limitations: ['GitHub answered 404'],
			rows: [
				{
					name: 'a|b',
					url: 'https://github.com/a/b',
					what: 'x',
					how: 'y',
					adoption_mode: 'idea',
					impact: 3,
					fit: 3,
					effort: 3,
					priority: 27,
					licence: 'MIT',
				},
			],
		});
		expect(md).toContain('16/11/2026');
		expect(md).toContain('[a b](https://github.com/a/b)');
		expect(md).not.toContain('—');
	});

	it('formats UK dates', () => {
		expect(ukDate('2026-01-05')).toBe('05/01/2026');
	});
});

describe('weekly-research workflow', () => {
	it('runs weekly and on demand only', () => {
		expect(Object.keys(workflow.on).sort()).toEqual([
			'schedule',
			'workflow_dispatch',
		]);
		expect(workflow.on.schedule[0].cron).toMatch(/^\d+ \d+ \* \* 1$/);
	});

	it('runs exactly three scouts with at most three in parallel', () => {
		const scout = workflow.jobs.scout;
		expect(scout.strategy.matrix.scout).toEqual(['github', 'web', 'lists']);
		expect(scout.strategy['max-parallel']).toBeLessThanOrEqual(3);
	});

	it('is read-only by default and only the report job can write', () => {
		expect(workflow.permissions).toEqual({ contents: 'read' });
		expect(workflow.jobs.scout.permissions).toEqual({ contents: 'read' });
		expect(workflow.jobs.report.permissions).toEqual({
			contents: 'write',
			'pull-requests': 'write',
		});
	});

	it('exposes model secrets only to the ranking step, never to the write job', () => {
		const text = readFileSync(
			resolve(root, '.github/workflows/weekly-research.yml'),
			'utf8'
		);
		const rank = workflow.jobs.scout.steps.find((s: any) =>
			s.name?.startsWith('Rank')
		);
		expect(Object.keys(rank.env).sort()).toEqual([
			'OPENAI_API_KEY',
			'OPENAI_API_MODEL',
			'OPENAI_API_URL',
		]);
		expect(JSON.stringify(workflow.jobs.report)).not.toContain('OPENAI_');
		expect(text.match(/secrets\./g)).toHaveLength(3);
	});

	it('never grants the ranking step the write token', () => {
		const scoutText = JSON.stringify(workflow.jobs.scout);
		expect(scoutText).not.toContain('contents":"write');
	});
});
