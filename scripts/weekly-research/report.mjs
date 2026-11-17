#!/usr/bin/env node
// Merge every scout's ranked.json, verify repositories against the GitHub API,
// and write the dated report, the docs index row, and the state file.
// Usage: node report.mjs <scoutsDir> <repoRoot>
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	SCOUTS,
	dropCovered,
	indexRow,
	isoDate,
	licenceFlag,
	renderReport,
} from './lib.mjs';

const [scoutsDir, root] = process.argv.slice(2);
if (!scoutsDir || !root) {
	console.error('usage: report.mjs <scoutsDir> <repoRoot>');
	process.exit(2);
}
const date = isoDate();
const limitations = [];
const scoutsRun = [];
let rows = [];
for (const scout of SCOUTS) {
	const file = join(scoutsDir, `scout-${scout}`, 'ranked.json');
	if (!existsSync(file)) {
		limitations.push(`The ${scout} scout produced no result.`);
		continue;
	}
	const data = JSON.parse(readFileSync(file, 'utf8'));
	scoutsRun.push(scout);
	rows.push(...data.rows);
	for (const e of data.errors ?? []) limitations.push(e);
}

// Skip anything already covered by earlier research.
const researchDir = join(root, 'docs', 'research');
// Exclude today's own report so a same-day rerun does not treat itself as prior art.
const corpus = readdirSync(researchDir)
	.filter((f) => f !== `weekly-${date}.md`)
	.map((f) => readFileSync(join(researchDir, f), 'utf8'))
	.join('\n');
const seen = new Set();
rows = dropCovered(rows, corpus).filter((r) => {
	const key = r.url.toLowerCase();
	if (seen.has(key)) return false;
	seen.add(key);
	return true;
});

// Verify GitHub repositories and attach licence; drop what does not exist.
// The step has a hard deadline so a slow API cannot exhaust the job timeout.
const VERIFY_DEADLINE = Date.now() + 8 * 60_000;
const verified = [];
for (const row of rows) {
	if (Date.now() > VERIFY_DEADLINE) {
		limitations.push(
			`Verification deadline reached; ${row.url} and later candidates were not verified and are omitted.`
		);
		break;
	}
	const match =
		new URL(row.url).hostname === 'github.com' &&
		new URL(row.url).pathname.match(/^\/([^/]+\/[^/]+?)\/?$/);
	if (!match) {
		verified.push({
			...row,
			licence: 'n/a (not a repository)',
			adoption_mode:
				row.adoption_mode === 'dependency' ? 'idea' : row.adoption_mode,
		});
		continue;
	}
	try {
		const res = await fetch(`https://api.github.com/repos/${match[1]}`, {
			headers: {
				'user-agent': 'weekly-research',
				...(process.env.GITHUB_TOKEN
					? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
					: {}),
			},
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) {
			limitations.push(`Dropped ${row.url}: GitHub answered ${res.status}.`);
			continue;
		}
		const repo = await res.json();
		if (repo.archived) continue;
		const spdx =
			repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
				? repo.license.spdx_id
				: null;
		const flag = licenceFlag(spdx);
		verified.push({
			...row,
			licence: spdx ?? 'unknown',
			adoption_mode: flag === 'permissive' ? row.adoption_mode : 'reference',
		});
	} catch (e) {
		limitations.push(`Could not verify ${row.url}: ${e.message}.`);
	}
}

writeFileSync(
	join(researchDir, `weekly-${date}.md`),
	renderReport({ date, rows: verified, limitations, scoutsRun })
);

const indexPath = join(root, 'docs', 'index.md');
const index = readFileSync(indexPath, 'utf8');
const marker = '\n## Historical decisions';
const at = index.indexOf(marker);
if (at !== -1 && !index.includes(`weekly-${date}.md`)) {
	writeFileSync(
		indexPath,
		`${index.slice(0, at).replace(/\n+$/, '\n')}${indexRow(date)}${index.slice(at)}`
	);
}

const statePath = join(root, '.product-intelligence', 'state.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
state.last_weekly_scan = date;
state.previous_research = [
	...new Set([
		...(state.previous_research ?? []),
		`docs/research/weekly-${date}.md`,
	]),
];
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
console.log(
	`report written: docs/research/weekly-${date}.md (${verified.length} candidates)`
);
