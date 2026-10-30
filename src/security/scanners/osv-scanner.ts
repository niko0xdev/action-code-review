import { computeFindingFingerprint } from '../findings/fingerprint.js';
import type {
	ScannerExecution,
	SecurityFinding,
	SecuritySeverity,
} from '../types.js';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_REQUEST_TIMEOUT_MS = 20_000;
const MAX_QUERIES_PER_BATCH = 50;
const MAX_BATCHES_IN_FLIGHT = 3;
const MAX_DEPENDENCIES_PER_RUN = 500;

interface AddedDependency {
	name: string;
	version: string;
	ecosystem: 'npm' | 'PyPI' | 'Go';
	file: string;
	line: number;
}

interface OsvSeverity {
	type: string;
	score: string;
}

interface OsvVuln {
	id: string;
	aliases?: string[];
	summary?: string;
	details?: string;
	severity?: OsvSeverity[];
	affected?: Array<{
		ranges?: Array<{ events?: Array<{ fixed?: string }> }>;
	}>;
}

/**
 * Extracts newly added (name, version) dependency pairs from diff patches.
 * Only pinned or resolvable versions are returned, since OSV queries
 * require an exact version to avoid noisy unversioned results.
 */
export function extractAddedDependencies(
	changedFiles: Array<{ filename: string; patch?: string }>
): AddedDependency[] {
	const deps: AddedDependency[] = [];

	for (const file of changedFiles) {
		if (!file.patch) continue;
		const lines = file.patch.split('\n');
		let currentLine = 1;
		let pendingNpmLockName: { name: string; line: number } | undefined;

		for (const rawLine of lines) {
			const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (hunkMatch) {
				currentLine = Number.parseInt(hunkMatch[1], 10);
				pendingNpmLockName = undefined;
				continue;
			}

			const isAdded = rawLine.startsWith('+') && !rawLine.startsWith('+++');
			const content = isAdded ? rawLine.slice(1) : rawLine;

			if (file.filename.endsWith('package.json') && isAdded) {
				const m = content.match(/^\s*"(@?[^"\s]+)"\s*:\s*"([^"]+)"\s*,?\s*$/);
				if (m) {
					const version = normaliseNpmVersion(m[2]);
					if (version) {
						deps.push({
							name: m[1],
							version,
							ecosystem: 'npm',
							file: file.filename,
							line: currentLine,
						});
					}
				}
			} else if (
				file.filename.endsWith('package-lock.json') ||
				file.filename.endsWith('npm-shrinkwrap.json')
			) {
				if (isAdded) {
					const nameMatch = content.match(
						/^\s*"node_modules\/([^"]+)"\s*:\s*\{\s*$/
					);
					if (nameMatch) {
						pendingNpmLockName = {
							name: nameMatch[1].replace(/\/[^/]+$/, ''),
							line: currentLine,
						};
						currentLine++;
						continue;
					}
					const versionMatch = content.match(
						/^\s*"version"\s*:\s*"([^"]+)"\s*,?\s*$/
					);
					if (versionMatch && pendingNpmLockName) {
						deps.push({
							name: pendingNpmLockName.name,
							version: versionMatch[1],
							ecosystem: 'npm',
							file: file.filename,
							line: pendingNpmLockName.line,
						});
						pendingNpmLockName = undefined;
					} else if (!/^\s*"[^"]+"\s*:/.test(content)) {
						pendingNpmLockName = undefined;
					}
				} else if (!rawLine.startsWith('-')) {
					pendingNpmLockName = undefined;
				}
			} else if (file.filename.endsWith('pnpm-lock.yaml') && isAdded) {
				const m = content.match(/^\s{2,}([^@\s:][^@\s]*?)@(\d[^\s(:]*)/);
				if (m) {
					deps.push({
						name: m[1],
						version: m[2],
						ecosystem: 'npm',
						file: file.filename,
						line: currentLine,
					});
				}
			} else if (
				/(?:^|\/)requirements(?:-[a-z]+)?\.txt$/.test(file.filename) &&
				isAdded
			) {
				const m = content.match(
					/^\s*([A-Za-z0-9_.\-]+)\s*==\s*([A-Za-z0-9_.\-+]+)/
				);
				if (m) {
					deps.push({
						name: m[1],
						version: m[2],
						ecosystem: 'PyPI',
						file: file.filename,
						line: currentLine,
					});
				}
			} else if (file.filename.endsWith('go.mod') && isAdded) {
				const m = content.match(/^\s*([a-zA-Z0-9_.\-/]+)\s+(v\d[^\s]*)/);
				if (m) {
					deps.push({
						name: m[1],
						version: m[2],
						ecosystem: 'Go',
						file: file.filename,
						line: currentLine,
					});
				}
			}

			if (!rawLine.startsWith('-')) currentLine++;
		}
	}

	const seen = new Set<string>();
	return deps.filter((d) => {
		const key = `${d.ecosystem}:${d.name}@${d.version}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function normaliseNpmVersion(spec: string): string | undefined {
	const m = spec.trim().match(/^[~^>=<v\s]*(\d+\.\d+\.\d+[^,\s|]*)$/);
	return m ? m[1] : undefined;
}

function cvssScoreToSeverity(score: number): SecuritySeverity {
	if (score >= 9) return 'critical';
	if (score >= 7) return 'high';
	if (score >= 4) return 'medium';
	return 'low';
}

function firstFixedVersion(vuln: OsvVuln): string | undefined {
	for (const affected of vuln.affected ?? []) {
		for (const range of affected.ranges ?? []) {
			for (const event of range.events ?? []) {
				if (event.fixed) return event.fixed;
			}
		}
	}
	return undefined;
}

function toFinding(dep: AddedDependency, vuln: OsvVuln): SecurityFinding {
	let severity: SecuritySeverity = 'medium';
	for (const s of vuln.severity ?? []) {
		if (s.type === 'CVSS_V3' || s.type === 'CVSS_V4') {
			const score = Number.parseFloat(s.score);
			if (!Number.isNaN(score)) {
				severity = cvssScoreToSeverity(score);
				break;
			}
		}
	}

	const aliases = (vuln.aliases ?? []).filter((a) => a !== vuln.id);
	const fixed = firstFixedVersion(vuln);
	const description = [
		`${dep.name}@${dep.version} (${dep.ecosystem}) is affected by ${vuln.id}.`,
		vuln.summary ?? vuln.details?.slice(0, 300) ?? 'No summary provided.',
		aliases.length > 0 ? `Aliases: ${aliases.join(', ')}.` : '',
		`Reference: https://osv.dev/vulnerability/${vuln.id}`,
	]
		.filter(Boolean)
		.join(' ');

	return {
		id: `osv-${vuln.id}-${dep.ecosystem}-${dep.name}-${dep.version}`,
		fingerprint: computeFindingFingerprint({
			title: vuln.id,
			file: dep.file,
			category: 'supply-chain',
		}),
		title: `Known vulnerability ${vuln.id} in ${dep.name}@${dep.version}`,
		severity,
		confidence: 'high',
		status: 'candidate',
		category: 'supply-chain',
		file: dep.file,
		startLine: dep.line,
		endLine: dep.line,
		evidence: [
			{
				type: 'scanner',
				description,
				file: dep.file,
				line: dep.line,
				source: 'osv',
			},
		],
		exploitability: 'likely',
		remediation: fixed
			? `Upgrade ${dep.name} to ${fixed} or later to remediate ${vuln.id}.`
			: `Upgrade ${dep.name} past the affected range to remediate ${vuln.id}; see https://osv.dev/vulnerability/${vuln.id}.`,
		scannerSources: ['osv-dependency-cve'],
	};
}

/**
 * Queries OSV.dev for known vulnerabilities in newly added dependencies.
 * Network and API errors are reported as `failed` so an unchecked run never
 * reads as clean; the scan never throws.
 */
export async function runOsvDependencyScan(
	changedFiles: Array<{ filename: string; patch?: string }>
): Promise<{ execution: ScannerExecution; findings: SecurityFinding[] }> {
	const start = Date.now();

	if (process.env.OSV_SCAN_DISABLED === '1') {
		return {
			execution: {
				name: 'osv-dependency-cve',
				status: 'skipped',
				reason: 'OSV scan disabled via OSV_SCAN_DISABLED=1',
				findings: 0,
				durationMs: 0,
			},
			findings: [],
		};
	}

	const allDeps = extractAddedDependencies(changedFiles);
	const deps = allDeps.slice(0, MAX_DEPENDENCIES_PER_RUN);
	const unqueried = allDeps.length - deps.length;
	if (deps.length === 0) {
		return {
			execution: {
				name: 'osv-dependency-cve',
				status: 'skipped',
				reason: 'No pinned dependencies added in this diff',
				findings: 0,
				durationMs: Date.now() - start,
			},
			findings: [],
		};
	}

	const batches: AddedDependency[][] = [];
	for (let i = 0; i < deps.length; i += MAX_QUERIES_PER_BATCH) {
		batches.push(deps.slice(i, i + MAX_QUERIES_PER_BATCH));
	}

	const findings: SecurityFinding[] = [];
	const errors: string[] = [];
	let next = 0;
	const worker = async () => {
		while (next < batches.length) {
			const batch = batches[next++];
			try {
				const found = await queryBatch(batch);
				findings.push(...found);
			} catch (err) {
				errors.push(err instanceof Error ? err.message : String(err));
			}
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(MAX_BATCHES_IN_FLIGHT, batches.length) },
			worker
		)
	);

	// A batch that never ran, or dependencies past the cap, must not read as a
	// clean CVE check, so either one reports `failed` (findings still publish).
	const reasons: string[] = [];
	if (unqueried > 0)
		reasons.push(
			`only the first ${MAX_DEPENDENCIES_PER_RUN} of ${allDeps.length} added dependencies were checked; ${unqueried} not queried`
		);
	if (errors.length > 0)
		reasons.push(
			`${errors.length} of ${batches.length} OSV.dev batches failed (offline or blocked egress?): ${errors[0].slice(0, 120)}`
		);

	return {
		execution: {
			name: 'osv-dependency-cve',
			status: reasons.length > 0 ? 'failed' : 'success',
			...(reasons.length > 0 && { reason: reasons.join('; ') }),
			findings: findings.length,
			durationMs: Date.now() - start,
		},
		findings,
	};
}

/** Queries one batch and maps results back to dependencies by index. Throws on any error. */
async function queryBatch(deps: AddedDependency[]): Promise<SecurityFinding[]> {
	const res = await fetch(OSV_BATCH_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			queries: deps.map((d) => ({
				package: { name: d.name, ecosystem: d.ecosystem },
				version: d.version,
			})),
		}),
		signal: AbortSignal.timeout(OSV_REQUEST_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`OSV.dev returned HTTP ${res.status}`);
	const payload = (await res.json()) as {
		results?: Array<{ vulns?: OsvVuln[] }>;
	};
	if (!payload || !Array.isArray(payload.results))
		throw new Error('OSV.dev response missing results array');
	const found: SecurityFinding[] = [];
	payload.results.forEach((result, i) => {
		const dep = deps[i];
		if (!dep) return;
		for (const vuln of result?.vulns ?? []) {
			if (typeof vuln?.id === 'string') found.push(toFinding(dep, vuln));
		}
	});
	return found;
}
