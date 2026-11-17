import { spawnSync } from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	escapeMd,
	parseModelJson,
	scrubSecrets,
} from '../scripts/weekly-research/lib.mjs';

const scripts = resolve(__dirname, '../scripts/weekly-research');
const KEY = 'sk-test-0123456789abcdef0123';

let tmp: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), 'wr-test-'));
});

/** Writes a fake `pi` that records its invocation and prints `body`. */
function stubPi(body: string, exitCode = 0): string {
	const bin = join(tmp, 'bin');
	mkdirSync(bin, { recursive: true });
	const file = join(bin, 'pi');
	writeFileSync(
		file,
		`#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(tmp, 'call.json'))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), entries: fs.readdirSync('.') }));
${body}
process.exit(${exitCode});
`
	);
	chmodSync(file, 0o755);
	return bin;
}

function seedData(urls: string[]): string {
	const dir = join(tmp, 'data');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'candidates.json'),
		JSON.stringify({
			scout: 'github',
			errors: ['github topic:x: 500'],
			items: urls.map((url) => ({
				name: url,
				url,
				description: 'd',
				stars: 1,
			})),
		})
	);
	return dir;
}

function rank(dir: string, bin: string) {
	return spawnSync('node', [join(scripts, 'rank.mjs'), dir], {
		encoding: 'utf8',
		env: {
			PATH: `${bin}:${process.env.PATH}`,
			HOME: tmp,
			OPENAI_API_KEY: KEY,
			OPENAI_API_MODEL: 'm',
		},
	});
}

describe('rank.mjs', () => {
	it('runs Pi with all tools disabled in an empty directory and embeds the data', () => {
		const dir = seedData(['https://github.com/a/b']);
		const bin = stubPi(
			`console.log(JSON.stringify([{name:'a/b',url:'https://github.com/a/b',what:'w',how:'h',adoption_mode:'idea',impact:4,fit:4,effort:4},{name:'x',url:'https://github.com/invented/x',impact:5,fit:5,effort:5}]))`
		);
		const res = rank(dir, bin);
		expect(res.status).toBe(0);
		const call = JSON.parse(readFileSync(join(tmp, 'call.json'), 'utf8'));
		expect(call.args).toContain('--no-tools');
		expect(call.args).not.toContain('--tools');
		expect(call.entries).toEqual([]);
		expect(call.args.at(-1)).toContain('https://github.com/a/b');
		const out = JSON.parse(readFileSync(join(dir, 'ranked.json'), 'utf8'));
		expect(out.rows.map((r: any) => r.url)).toEqual(['https://github.com/a/b']);
		expect(out.errors).toContain('github topic:x: 500');
	});

	it('scrubs the API key from model output before writing', () => {
		const dir = seedData(['https://github.com/a/b']);
		const bin = stubPi(
			`console.log(JSON.stringify([{name:'${KEY}',url:'https://github.com/a/b',what:'leak ${KEY}',how:'h',impact:3,fit:3,effort:3}]))`
		);
		expect(rank(dir, bin).status).toBe(0);
		const raw = readFileSync(join(dir, 'ranked.json'), 'utf8');
		expect(raw).not.toContain(KEY);
		expect(raw).toContain('[REDACTED]');
	});

	it('scrubs secrets from harness stderr', () => {
		const dir = seedData(['https://github.com/a/b']);
		const bin = stubPi(`console.error('boom ${KEY}')`, 3);
		const res = rank(dir, bin);
		expect(res.status).toBe(1);
		expect(res.stderr).not.toContain(KEY);
		expect(res.stderr).toContain('[REDACTED]');
	});

	it('fails loudly on unparseable output or a non-array answer', () => {
		const dir = seedData(['https://github.com/a/b']);
		expect(rank(dir, stubPi("console.log('no json')")).status).toBe(1);
		expect(rank(dir, stubPi('console.log(\'{"rows":[]}\')')).status).toBe(1);
	});

	it('records a limitation when no returned row matches collected URLs', () => {
		const dir = seedData(['https://github.com/a/b']);
		const bin = stubPi(
			`console.log(JSON.stringify([{name:'x',url:'https://github.com/nope/x',impact:3,fit:3,effort:3}]))`
		);
		expect(rank(dir, bin).status).toBe(0);
		const out = JSON.parse(readFileSync(join(dir, 'ranked.json'), 'utf8'));
		expect(out.rows).toEqual([]);
		expect(out.errors.join(' ')).toMatch(/none matched/);
	});
});

describe('report.mjs', () => {
	it('writes the report, index row, and state idempotently', () => {
		const root = join(tmp, 'root');
		mkdirSync(join(root, 'docs/research'), { recursive: true });
		mkdirSync(join(root, '.product-intelligence'), { recursive: true });
		writeFileSync(
			join(root, 'docs/index.md'),
			'# Docs\n\n| a | b | c |\n\n## Historical decisions\n'
		);
		writeFileSync(
			join(root, 'docs/research/old.md'),
			'covered https://example.org/already-covered'
		);
		writeFileSync(
			join(root, '.product-intelligence/state.json'),
			JSON.stringify({ previous_research: [] })
		);
		const scouts = join(tmp, 'scouts');
		for (const s of ['github', 'web', 'lists']) {
			mkdirSync(join(scouts, `scout-${s}`), { recursive: true });
		}
		const row = (url: string, name: string) => ({
			name,
			url,
			what: 'w [x](http://evil)',
			how: 'h',
			adoption_mode: 'dependency',
			impact: 4,
			fit: 4,
			effort: 4,
			priority: 64,
		});
		writeFileSync(
			join(scouts, 'scout-web/ranked.json'),
			JSON.stringify({
				scout: 'web',
				errors: [],
				rows: [
					row('https://example.org/post', 'Post'),
					row('https://example.org/already-covered', 'Covered'),
				],
			})
		);
		const run = () =>
			spawnSync('node', [join(scripts, 'report.mjs'), scouts, root], {
				encoding: 'utf8',
			});
		expect(run().status).toBe(0);
		expect(run().status).toBe(0);
		const date = new Date().toISOString().slice(0, 10);
		const report = readFileSync(
			join(root, `docs/research/weekly-${date}.md`),
			'utf8'
		);
		expect(report).toContain('https://example.org/post');
		expect(report).not.toContain('already-covered');
		expect(report).not.toContain('[x](http://evil)');
		expect(report).toContain('The github scout produced no result.');
		const index = readFileSync(join(root, 'docs/index.md'), 'utf8');
		expect(index.match(new RegExp(`weekly-${date}.md`, 'g'))).toHaveLength(2);
		const state = JSON.parse(
			readFileSync(join(root, '.product-intelligence/state.json'), 'utf8')
		);
		expect(state.last_weekly_scan).toBe(date);
		expect(state.previous_research).toEqual([
			`docs/research/weekly-${date}.md`,
		]);
	});
});

describe('collect.mjs', () => {
	it('rejects an unknown scout', () => {
		const res = spawnSync('node', [join(scripts, 'collect.mjs'), 'nope', tmp], {
			encoding: 'utf8',
		});
		expect(res.status).toBe(2);
	});
});

describe('hardening helpers', () => {
	it('scrubs exact secrets and common token shapes', () => {
		const out = scrubSecrets(
			`k=${KEY} t=ghp_${'a'.repeat(30)} Bearer ${'b'.repeat(24)}`,
			[KEY]
		);
		expect(out).not.toMatch(/sk-test|ghp_a|bbbbbbbb/);
	});

	it('escapes Markdown so untrusted text cannot form links', () => {
		expect(escapeMd('[x](http://evil)')).toBe('\\[x\\]\\(http://evil\\)');
	});

	it('parses fenced and prose-wrapped JSON', () => {
		expect(parseModelJson('```json\n[{"a":1}]\n```')).toEqual([{ a: 1 }]);
		expect(parseModelJson('Answer: [1,2] bye')).toEqual([1, 2]);
	});
});

describe('collect.mjs with a stubbed network', () => {
	it('collects, normalises, dedupes, and records per-query failures', () => {
		const stub = join(tmp, 'fetch-stub.mjs');
		writeFileSync(
			stub,
			`globalThis.fetch = async (url) => {
	const u = String(url);
	if (u.includes('topic%3Asast')) return new Response('nope', { status: 500 });
	if (u.includes('api.github.com/search')) {
		return Response.json({ items: [
			{ full_name: 'a/b', html_url: 'https://github.com/a/b', description: 'x @evil <b>', stargazers_count: 50, pushed_at: '2026-11-01' },
			{ full_name: 'bad', html_url: 'javascript:alert(1)', description: 'x' },
		] });
	}
	return Response.json({ items: [] });
};`
		);
		const out = join(tmp, 'out');
		const res = spawnSync(
			'node',
			['--import', stub, join(scripts, 'collect.mjs'), 'github', out],
			{ encoding: 'utf8' }
		);
		expect(res.status).toBe(0);
		const data = JSON.parse(readFileSync(join(out, 'candidates.json'), 'utf8'));
		expect(data.items).toHaveLength(1);
		expect(data.items[0].description).not.toMatch(/[<>@]/);
		expect(data.errors.join(' ')).toMatch(/topic:sast: .*500/);
	});

	it('exits non-zero when every source fails', () => {
		const stub = join(tmp, 'fail-stub.mjs');
		writeFileSync(
			stub,
			"globalThis.fetch = async () => new Response('x', { status: 503 });"
		);
		const res = spawnSync(
			'node',
			['--import', stub, join(scripts, 'collect.mjs'), 'web', join(tmp, 'o2')],
			{ encoding: 'utf8' }
		);
		expect(res.status).toBe(1);
	});
});

describe('untrusted-data bounds', () => {
	it('caps rows per scout and encodes link targets', async () => {
		const { validateRanked, linkTarget, MAX_ROWS_PER_SCOUT } = await import(
			'../scripts/weekly-research/lib.mjs'
		);
		const urls = Array.from(
			{ length: 30 },
			(_, i) => `https://github.com/a/r${i}`
		);
		const rows = validateRanked(
			urls.map((url) => ({ name: url, url, impact: 3, fit: 3, effort: 3 })),
			urls
		);
		expect(rows).toHaveLength(MAX_ROWS_PER_SCOUT);
		expect(linkTarget('https://e.org/a_(b)')).toBe('https://e.org/a_%28b%29');
	});
});
