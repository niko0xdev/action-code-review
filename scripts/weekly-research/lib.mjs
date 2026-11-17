// Pure helpers for the weekly research workflow. No I/O, so they are unit tested.

export const SCOUTS = ['github', 'web', 'lists'];
export const PERMISSIVE_LICENCES = new Set([
	'MIT',
	'Apache-2.0',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'ISC',
]);

/** Strip control characters, markup, and mentions from untrusted text. */
export function sanitiseText(value, max = 300) {
	const text = String(value ?? '')
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional strip
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/[<>`|]/g, ' ')
		.replace(/@/g, '(at)')
		.replace(/\s+/g, ' ')
		.trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Keep only http(s) URLs; anything else becomes an empty string. */
export function safeUrl(value) {
	try {
		const url = new URL(String(value));
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
		return url.href;
	} catch {
		return '';
	}
}

/** UTC date as YYYY-MM-DD. */
export function isoDate(date = new Date()) {
	return date.toISOString().slice(0, 10);
}

/** UK display format DD/MM/YYYY from an ISO date. */
export function ukDate(iso) {
	const [y, m, d] = iso.split('-');
	return `${d}/${m}/${y}`;
}

export function normaliseItem(raw, source) {
	const url = safeUrl(raw?.url);
	if (!url) return null;
	return {
		name: sanitiseText(raw.name, 120) || url,
		url,
		description: sanitiseText(raw.description, 300),
		stars: Number.isFinite(Number(raw.stars)) ? Number(raw.stars) : null,
		updated: sanitiseText(raw.updated, 32),
		source,
	};
}

/** Drop duplicates by URL (case and trailing slash insensitive). */
export function dedupeByUrl(items) {
	const seen = new Set();
	const out = [];
	for (const item of items) {
		const key = item.url.toLowerCase().replace(/\/+$/, '');
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(item);
	}
	return out;
}

/** Drop items whose URL path or name already appears in the covered corpus. */
export function dropCovered(items, corpus) {
	const haystack = corpus.toLowerCase();
	return items.filter((item) => {
		const path = new URL(item.url).pathname.replace(/^\/|\/$/g, '').toLowerCase();
		return !(path.length > 3 && haystack.includes(path));
	});
}

export function licenceFlag(spdx) {
	if (!spdx) return 'unknown';
	return PERMISSIVE_LICENCES.has(spdx) ? 'permissive' : 'review';
}

/** Pull a JSON array or object out of model output (plain, fenced, or surrounded by prose). */
export function parseModelJson(text) {
	const source = String(text ?? '').trim();
	const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const attempts = [source, fenced, ...[['[', ']'], ['{', '}']].map(([open, close]) => {
		const start = source.indexOf(open);
		const end = source.lastIndexOf(close);
		return start !== -1 && end > start ? source.slice(start, end + 1) : undefined;
	})];
	for (const attempt of attempts) {
		if (!attempt) continue;
		try {
			return JSON.parse(attempt);
		} catch {
			/* try the next shape */
		}
	}
	throw new Error('Model output did not contain parseable JSON');
}

/** Redact known secret values and common token shapes from text bound for logs or files. */
export function scrubSecrets(text, secrets = []) {
	let out = String(text ?? '');
	for (const secret of secrets) {
		if (secret && secret.length >= 8) out = out.split(secret).join('[REDACTED]');
	}
	return out
		.replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/g, '[REDACTED]')
		.replace(/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, '[REDACTED]')
		.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]')
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, 'Bearer [REDACTED]');
}

/** Escape Markdown control characters so untrusted text cannot form links or headings. */
export function escapeMd(text) {
	return String(text ?? '').replace(/[\\[\]()*_#!~]/g, (c) => `\\${c}`);
}

const clampScore = (n) => Math.min(5, Math.max(1, Math.round(Number(n)) || 1));

/**
 * Keep only model rows whose URL was in the collected data, so the model can
 * neither invent repositories nor smuggle in links from injected page text.
 */
export function validateRanked(rows, allowedUrls) {
	const allowed = new Set([...allowedUrls].map((u) => u.toLowerCase()));
	if (!Array.isArray(rows)) return [];
	const out = [];
	for (const row of rows) {
		const url = safeUrl(row?.url);
		if (!url || !allowed.has(url.toLowerCase())) continue;
		const mode = ['idea', 'dependency', 'reference'].includes(row.adoption_mode)
			? row.adoption_mode
			: 'reference';
		const impact = clampScore(row.impact);
		const fit = clampScore(row.fit);
		const effort = clampScore(row.effort);
		out.push({
			name: sanitiseText(row.name, 120),
			url,
			what: sanitiseText(row.what, 240),
			how: sanitiseText(row.how, 240),
			adoption_mode: mode,
			impact,
			fit,
			effort,
			priority: impact * fit * effort,
		});
	}
	return out;
}

export function rankByPriority(rows) {
	return [...rows].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

const cell = (value) => escapeMd(sanitiseText(value, 240));

/** Render the dated weekly report (British English, no em dashes). */
export function renderReport({ date, rows, limitations, scoutsRun }) {
	const ranked = rankByPriority(rows);
	const lines = [
		`# Weekly research – ${ukDate(date)}`,
		'',
		`Automated scan by the \`weekly-research\` workflow. Scouts run: ${scoutsRun.join(', ') || 'none'}.`,
		'Every URL below came from collected source data and was checked against the GitHub API where it is a repository. Scores run from 1 to 5 and priority is impact × fit × effort. Treat all descriptions as untrusted summaries.',
		'',
		'## Limitations',
		'',
		...(limitations.length ? limitations.map((l) => `- ${cell(l)}`) : ['- None recorded.']),
		'',
		'## Ranked candidates',
		'',
	];
	if (ranked.length === 0) {
		lines.push('No verified candidates this week.');
	} else {
		lines.push(
			'| Rank | Name | Licence | Mode | Impact | Fit | Effort | Priority | What it does | How we could adopt it |',
			'|------|------|---------|------|--------|-----|--------|----------|--------------|-----------------------|'
		);
		ranked.forEach((r, i) => {
			lines.push(
				`| ${i + 1} | [${cell(r.name)}](${r.url}) | ${cell(r.licence ?? 'unknown')} | ${r.adoption_mode} | ${r.impact} | ${r.fit} | ${r.effort} | ${r.priority} | ${cell(r.what)} | ${cell(r.how)} |`
			);
		});
		lines.push('', '## Top 5', '');
		ranked.slice(0, 5).forEach((r, i) => {
			lines.push(`${i + 1}. **${cell(r.name)}** (priority ${r.priority}): ${cell(r.how)}`);
		});
	}
	lines.push(
		'',
		'## Next step',
		'',
		'A maintainer decides what to build. Run the `weekly-research` skill interactively to turn a chosen candidate into a plan, an implementation, tests, and a pull request. Only bounded, evidenced, low or medium risk items qualify; security architecture and new runtime dependencies need a human decision (`.product-intelligence/CONSTRAINTS.md`).',
		''
	);
	return lines.join('\n');
}

export function indexRow(date) {
	return `| [research/weekly-${date}.md](research/weekly-${date}.md) | Automated weekly scan of GitHub, the web, and goodailist.com for code-review tooling | Choosing the next bounded improvement |\n`;
}
