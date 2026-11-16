#!/usr/bin/env node
// Deterministic collection for one scout. Usage: node collect.mjs <scout> <outDir>
// Network failures are recorded, never fatal: a partial week is still useful.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCOUTS, dedupeByUrl, normaliseItem } from './lib.mjs';

const TIMEOUT_MS = 20_000;
const sinceDays = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

async function getJson(url, headers = {}) {
	const res = await fetch(url, {
		headers: { 'user-agent': 'weekly-research', accept: 'application/json', ...headers },
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
	return res.json();
}

const ghHeaders = () =>
	process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};

const GITHUB_QUERIES = [
	'topic:code-review',
	'topic:ai-code-review',
	'topic:pr-review',
	'topic:sast',
	'topic:static-analysis',
	'topic:llm-evaluation',
	'topic:semgrep',
];

const sources = {
	async github(errors) {
		const items = [];
		for (const q of GITHUB_QUERIES) {
			try {
				const query = encodeURIComponent(`${q} pushed:>${sinceDays(90)} stars:>20`);
				const data = await getJson(
					`https://api.github.com/search/repositories?q=${query}&sort=updated&per_page=15`,
					ghHeaders()
				);
				for (const r of data.items ?? [])
					items.push({ name: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count, updated: r.pushed_at });
			} catch (e) {
				errors.push(`github ${q}: ${e.message}`);
			}
		}
		return items;
	},
	async web(errors) {
		const items = [];
		const since = Math.floor(Date.now() / 1000 - 30 * 864e5);
		for (const q of ['code review', 'ai code review', 'static analysis', 'prompt injection']) {
			try {
				const data = await getJson(
					`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=15`
				);
				for (const h of data.hits ?? [])
					items.push({ name: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, description: `HN, ${h.points} points`, updated: h.created_at });
			} catch (e) {
				errors.push(`hn ${q}: ${e.message}`);
			}
		}
		for (const tag of ['codereview', 'staticanalysis', 'devsecops']) {
			try {
				const data = await getJson(`https://dev.to/api/articles?tag=${tag}&top=7&per_page=10`);
				for (const a of data)
					items.push({ name: a.title, url: a.url, description: a.description, updated: a.published_at });
			} catch (e) {
				errors.push(`dev.to ${tag}: ${e.message}`);
			}
		}
		return items;
	},
	async lists(errors) {
		const items = [];
		for (const q of ['code review', 'static analysis', 'security scanner', 'llm evaluation']) {
			try {
				const data = await getJson(
					`https://goodailist.com/api/repos?search=${encodeURIComponent(q)}&sort=star_7d&limit=20`
				);
				for (const r of data.repos ?? [])
					if (!r.archived)
						items.push({ name: r.repo, url: `https://github.com/${r.repo}`, description: r.description, stars: r.stars, updated: r.updated_at });
			} catch (e) {
				errors.push(`goodailist ${q}: ${e.message}`);
			}
		}
		for (const repo of ['analysis-tools-dev/static-analysis', 'awesome-skills/code-review-skill']) {
			try {
				const res = await fetch(`https://api.github.com/repos/${repo}`, { headers: { 'user-agent': 'weekly-research', ...ghHeaders() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
				if (res.ok) {
					const r = await res.json();
					items.push({ name: r.full_name, url: r.html_url, description: r.description, stars: r.stargazers_count, updated: r.pushed_at });
				}
			} catch (e) {
				errors.push(`list ${repo}: ${e.message}`);
			}
		}
		return items;
	},
};

const [scout, outDir] = process.argv.slice(2);
if (!SCOUTS.includes(scout) || !outDir) {
	console.error(`usage: collect.mjs <${SCOUTS.join('|')}> <outDir>`);
	process.exit(2);
}
const errors = [];
const raw = await sources[scout](errors);
const items = dedupeByUrl(raw.map((r) => normaliseItem(r, scout)).filter(Boolean));
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'candidates.json'), JSON.stringify({ scout, items, errors }, null, 2));
console.log(`${scout}: ${items.length} candidates, ${errors.length} errors`);
if (items.length === 0 && errors.length > 0) process.exit(1);
