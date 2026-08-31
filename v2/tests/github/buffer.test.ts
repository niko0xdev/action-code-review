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

import { BUFFER_PATH, classifyFindings } from '../../src/github/buffer.js';
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
			...finding(),
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
	it('defaults to /tmp/ai-inline-buffer.jsonl', () => {
		expect(BUFFER_PATH).toContain('ai-inline-buffer');
	});
});
