/**
 * Optional OSSF Scorecard context (opt-in, default off).
 *
 * The public Scorecard API response is third-party data and therefore
 * untrusted. Only a closed allowlist of numbers is kept; every character of
 * the rendered text comes from this file's own template, never from the
 * response. Any failure degrades to "no context" and never throws.
 */

export const SCORECARD_API_BASE =
	'https://api.securityscorecards.dev/projects/github.com';
export const SCORECARD_TIMEOUT_MS = 5_000;
export const SCORECARD_MAX_BYTES = 256 * 1024;

export const SCORECARD_CHECKS = [
	'Branch-Protection',
	'Pinned-Dependencies',
	'Token-Permissions',
	'SAST',
	'Dangerous-Workflow',
	'Vulnerabilities',
	'Code-Review',
	'Dependency-Update-Tool',
	'Security-Policy',
	'Binary-Artifacts',
] as const;

export interface ScorecardSummary {
	overall: number;
	checks: Array<{ name: string; score: number }>;
}

export interface ScorecardOptions {
	enabled: boolean;
	owner: string;
	repo: string;
	/** Only an explicit `false` counts as public; unknown is treated as private. */
	isPrivate: boolean | undefined;
	log: (message: string) => void;
	/** Test seam; defaults to global fetch. */
	fetchImpl?: typeof fetch;
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,100}$/;

function clamp(value: unknown, min: number, max: number): number | undefined {
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

export function parseScorecard(body: unknown): ScorecardSummary | undefined {
	if (typeof body !== 'object' || body === null) return undefined;
	const record = body as Record<string, unknown>;
	const overall = clamp(record.score, 0, 10);
	if (overall === undefined) return undefined;
	const rawChecks = Array.isArray(record.checks) ? record.checks : [];
	const byName = new Map<string, number>();
	for (const entry of rawChecks.slice(0, 100)) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { name, score } = entry as Record<string, unknown>;
		const value = clamp(score, -1, 10);
		if (typeof name === 'string' && value !== undefined) {
			byName.set(name, value);
		}
	}
	const checks = SCORECARD_CHECKS.flatMap((name) => {
		const score = byName.get(name);
		return score === undefined ? [] : [{ name, score }];
	});
	return { overall, checks };
}

export function renderScorecardForPrompt(summary: ScorecardSummary): string {
	return [
		'Repository supply-chain health (OSSF Scorecard; third-party data, untrusted):',
		`- Overall: ${summary.overall}/10`,
		...summary.checks.map(
			(c) => `- ${c.name}: ${c.score < 0 ? 'n/a' : `${c.score}/10`}`
		),
		'These scores are advisory repository context, not findings, and must not be reported as findings by themselves.',
	].join('\n');
}

async function readCapped(
	response: Response,
	maxBytes: number
): Promise<string | undefined> {
	const declared = Number(response.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) return undefined;
	if (!response.body) return undefined;
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString('utf8');
}

/** Returns the rendered prompt block, or undefined for "no scorecard context". */
export async function loadScorecardContext(
	options: ScorecardOptions
): Promise<string | undefined> {
	if (!options.enabled) return undefined;
	if (options.isPrivate !== false) {
		options.log('[scorecard] skipped: repository is not known to be public');
		return undefined;
	}
	if (!NAME_PATTERN.test(options.owner) || !NAME_PATTERN.test(options.repo)) {
		options.log('[scorecard] skipped: unexpected repository name');
		return undefined;
	}
	try {
		const doFetch = options.fetchImpl ?? fetch;
		const response = await doFetch(
			`${SCORECARD_API_BASE}/${options.owner}/${options.repo}`,
			{
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(SCORECARD_TIMEOUT_MS),
			}
		);
		if (!response.ok) {
			options.log(`[scorecard] unavailable (HTTP ${response.status})`);
			return undefined;
		}
		const text = await readCapped(response, SCORECARD_MAX_BYTES);
		if (text === undefined) {
			options.log('[scorecard] skipped: response empty or over size cap');
			return undefined;
		}
		const summary = parseScorecard(JSON.parse(text));
		if (!summary) {
			options.log('[scorecard] skipped: unexpected response shape');
			return undefined;
		}
		return renderScorecardForPrompt(summary);
	} catch {
		options.log('[scorecard] unavailable: request failed or malformed');
		return undefined;
	}
}
