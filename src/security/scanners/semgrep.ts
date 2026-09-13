import { spawn } from 'node:child_process';
import { computeFindingFingerprint } from '../findings/fingerprint.js';
import type {
	ScannerExecution,
	SecurityFinding,
	SecuritySeverity,
} from '../types.js';

interface SemgrepCliFinding {
	check_id: string;
	path: string;
	start: { line: number; col: number };
	end: { line: number; col: number };
	extra: {
		message: string;
		severity: string;
		metadata?: {
			cwe?: string[] | string;
			owasp?: string[] | string;
			confidence?: string;
			impact?: string;
		};
	};
}

function toFinding(r: unknown): SecurityFinding | undefined {
	const rec = r as Partial<SemgrepCliFinding>;
	if (
		typeof rec?.check_id !== 'string' ||
		typeof rec?.path !== 'string' ||
		typeof rec?.start?.line !== 'number' ||
		typeof rec?.end?.line !== 'number' ||
		typeof rec?.extra?.message !== 'string' ||
		typeof rec?.extra?.severity !== 'string'
	) {
		return undefined;
	}
	const sevMap: Record<string, SecuritySeverity> = {
		ERROR: 'high',
		WARNING: 'medium',
		INFO: 'low',
	};
	const severity = sevMap[rec.extra.severity] || 'medium';
	const cwe = Array.isArray(rec.extra.metadata?.cwe)
		? rec.extra.metadata?.cwe[0]
		: typeof rec.extra.metadata?.cwe === 'string'
			? rec.extra.metadata.cwe
			: undefined;
	const owasp = Array.isArray(rec.extra.metadata?.owasp)
		? rec.extra.metadata?.owasp[0]
		: typeof rec.extra.metadata?.owasp === 'string'
			? rec.extra.metadata.owasp
			: undefined;

	return {
		id: `semgrep-${rec.check_id}-${rec.path}-${rec.start.line}`,
		fingerprint: computeFindingFingerprint({
			title: rec.check_id,
			file: rec.path,
			category: 'sast',
			cwe,
		}),
		title: rec.check_id.split('.').pop() || rec.check_id,
		severity,
		confidence: 'high',
		status: 'candidate',
		category: 'security',
		cwe,
		owasp,
		file: rec.path,
		startLine: rec.start.line,
		endLine: rec.end.line,
		evidence: [
			{
				type: 'scanner',
				description: rec.extra.message,
				file: rec.path,
				line: rec.start.line,
				source: 'semgrep',
			},
		],
		exploitability: 'likely',
		remediation: `Address rule violation reported by Semgrep (${rec.check_id}).`,
		scannerSources: ['semgrep'],
	};
}

/**
 * Execute Semgrep CLI if installed and parse JSON output.
 * Spec reference: §13.
 */
export async function runSemgrepScanner(
	repositoryPath: string,
	targetFiles: string[]
): Promise<{ execution: ScannerExecution; findings: SecurityFinding[] }> {
	const start = Date.now();
	if (targetFiles.length === 0) {
		return {
			execution: {
				name: 'semgrep',
				status: 'skipped',
				reason: 'No eligible files for Semgrep scan',
				findings: 0,
				durationMs: 0,
			},
			findings: [],
		};
	}

	return new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let settled = false;

		const timeout = setTimeout(() => {
			if (!settled) {
				settled = true;
				try {
					proc.kill('SIGKILL');
				} catch {
					// Ignore
				}
				resolve({
					execution: {
						name: 'semgrep',
						status: 'failed',
						reason: 'Semgrep scan timed out after 60s',
						findings: 0,
						durationMs: Date.now() - start,
					},
					findings: [],
				});
			}
		}, 60_000);

		const args = ['scan', '--json', '--quiet', ...targetFiles];
		const proc = spawn('semgrep', args, {
			cwd: repositoryPath,
			env: { ...process.env, SEMGREP_SEND_METRICS: 'off' },
		});

		proc.stdout?.on('data', (d) => {
			stdout += d.toString();
		});
		proc.stderr?.on('data', (d) => {
			stderr += d.toString();
		});

		proc.on('error', (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			const code = (err as NodeJS.ErrnoException).code;
			if (code === 'ENOENT') {
				resolve({
					execution: {
						name: 'semgrep',
						status: 'skipped',
						reason: `Semgrep CLI not available: ${err.message}`.slice(0, 200),
						findings: 0,
						durationMs: Date.now() - start,
					},
					findings: [],
				});
				return;
			}
			resolve({
				execution: {
					name: 'semgrep',
					status: 'failed',
					reason:
						`Semgrep failed to launch (${code ?? 'error'}): ${err.message}`.slice(
							0,
							200
						),
					findings: 0,
					durationMs: Date.now() - start,
				},
				findings: [],
			});
		});

		proc.on('close', (code, signal) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);

			const abnormal = code !== 0 || signal !== null;
			const stderrHint = stderr.trim().slice(0, 100);

			let data: { results?: unknown; errors?: unknown };
			try {
				data = JSON.parse(stdout);
			} catch (parseError) {
				resolve({
					execution: {
						name: 'semgrep',
						status: 'failed',
						reason:
							`Failed to parse Semgrep output JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`.slice(
								0,
								200
							),
						findings: 0,
						durationMs: Date.now() - start,
					},
					findings: [],
				});
				return;
			}

			if (!data || !Array.isArray(data.results)) {
				resolve({
					execution: {
						name: 'semgrep',
						status: 'failed',
						reason: 'Semgrep output missing results array'.slice(0, 200),
						findings: 0,
						durationMs: Date.now() - start,
					},
					findings: [],
				});
				return;
			}

			const structuredErrors = Array.isArray(data.errors) ? data.errors : [];
			const incomplete = abnormal || structuredErrors.length > 0;

			const findings: SecurityFinding[] = [];
			for (const r of data.results as unknown[]) {
				const finding = toFinding(r);
				if (finding) findings.push(finding);
			}

			if (incomplete) {
				const detail =
					structuredErrors.length > 0
						? `${structuredErrors.length} error(s)`
						: signal
							? `signal ${signal}`
							: `exit ${code}`;
				const reason = `Semgrep scan incomplete (${detail})${stderrHint ? `: ${stderrHint}` : ''}`;
				resolve({
					execution: {
						name: 'semgrep',
						status: 'failed',
						reason: reason.slice(0, 200),
						findings: findings.length,
						durationMs: Date.now() - start,
					},
					findings,
				});
				return;
			}

			resolve({
				execution: {
					name: 'semgrep',
					status: 'success',
					findings: findings.length,
					durationMs: Date.now() - start,
				},
				findings,
			});
		});
	});
}
