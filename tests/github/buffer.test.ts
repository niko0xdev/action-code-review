import {
	appendFileSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	BUFFER_PATH,
	classifyFindings,
	defaultBufferPath,
} from '../../src/github/buffer.js';
import type { Finding } from '../../src/types/finding.js';

function finding(overrides: Partial<Finding> = {}): Finding {
	return {
		path: 'src/a.ts',
		line: 10,
		severity: 'high',
		confidence: 0.9,
		category: 'security',
		title: 'Real issue',
		description: 'Null dereference in handler',
		impact: 'crash',
		...overrides,
	};
}

describe('classifyFindings', () => {
	it('keeps real findings and filters test probes', () => {
		const real = {
			...finding(),
			ts: new Date().toISOString(),
			title: 'SQL injection in query',
		};
		const probe = {
			...finding({ severity: 'low' }),
			ts: new Date().toISOString(),
			title: 'Test comment — does this work?',
		};
		const { real: kept, probe: filtered } = classifyFindings([
			real as any,
			probe as any,
		]);
		expect(kept.length).toBe(1);
		expect(filtered.length).toBe(1);
		expect(filtered[0].title).toContain('Test comment');
	});

	it('never treats a medium or higher finding as a probe, whatever its title', () => {
		const findings = (['critical', 'high', 'medium'] as const).map(
			(severity) => ({
				...finding({
					severity,
					title: 'Checking if the caller is admin happens after the write',
				}),
				ts: new Date().toISOString(),
			})
		);
		const { real, probe } = classifyFindings(findings as any);
		expect(real).toHaveLength(3);
		expect(probe).toHaveLength(0);
	});

	it('never posts confirmed=false regardless of title', () => {
		const f = {
			...finding({ title: 'Real title' }),
			ts: new Date().toISOString(),
			confirmed: false,
		};
		const { real, probe } = classifyFindings([f as any]);
		expect(real.length).toBe(0);
		expect(probe.length).toBe(1);
	});

	it('returns empty when all are confirmed=false', () => {
		const f = {
			...finding(),
			ts: new Date().toISOString(),
			confirmed: false,
		} as any;
		const { real } = classifyFindings([f]);
		expect(real.length).toBe(0);
	});
});

describe('BUFFER_PATH', () => {
	it('names the inline buffer file', () => {
		expect(BUFFER_PATH).toContain('ai-inline-buffer');
	});

	it('lives in the per-job runner temp directory when available', () => {
		expect(defaultBufferPath({ RUNNER_TEMP: '/runner/_temp' })).toBe(
			join('/runner/_temp', 'ai-inline-buffer.jsonl')
		);
		expect(
			defaultBufferPath({
				RUNNER_TEMP: '/runner/_temp',
				AI_INLINE_BUFFER_PATH: '/custom.jsonl',
			})
		).toBe('/custom.jsonl');
	});
});
