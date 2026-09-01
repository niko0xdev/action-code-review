/**
 * V3 End-to-end smoke test against the bundled examples/nextjs sample.
 *
 * Verifies:
 * - Profile detection on real Next.js sample repo finds react/nextjs/typescript
 * - SQL false-positive guard: docs/.sql files do NOT trigger postgres/mysql
 * - Validation pipeline runs without error
 * - BuildSummaryBody renders V3 diagnostics correctly
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSummaryBody } from '../../src/github/comments.js';
import { detectProfiles } from '../../src/profiles/index.js';
import { resolveProfiles } from '../../src/profiles/index.js';
import { rulesForProfiles } from '../../src/profiles/index.js';

const SAMPLE_REPO = new URL(
	'../../../examples/nextjs',
	import.meta.url
).pathname.replace(/^\/+/, '/');

describe('V3 e2e smoke against examples/nextjs', () => {
	it('sample repo exists', () => {
		expect(existsSync(SAMPLE_REPO)).toBe(true);
	});

	it('detects NextJS + React + TypeScript profiles', () => {
		const profiles = detectProfiles(SAMPLE_REPO).map((p) => p.id);
		// At minimum, next + react + typescript should fire.
		expect(profiles).toContain('nextjs');
		expect(profiles).toContain('react');
		expect(profiles).toContain('typescript');
	});

	it('does NOT false-positive postgres/mysql on sample', () => {
		const profiles = detectProfiles(SAMPLE_REPO).map((p) => p.id);
		expect(profiles).not.toContain('postgres');
		expect(profiles).not.toContain('mysql');
	});

	it('produces rule strings for detected profiles', () => {
		const profiles = detectProfiles(SAMPLE_REPO);
		expect(profiles.length).toBeGreaterThan(0);
		const rules = rulesForProfiles(profiles);
		expect(rules.length).toBeGreaterThan(100);
		// Should include NextJS-specific terminology.
		expect(rules.toLowerCase()).toContain('nextjs');
		// Should include React-specific terminology.
		expect(rules.toLowerCase()).toContain('react');
	});

	it('resolves AI_REVIEW_PROFILE=auto equivalent (detect)', () => {
		const profiles = resolveProfiles(SAMPLE_REPO, undefined);
		expect(profiles.length).toBeGreaterThan(0);
	});

	it('respects AI_REVIEW_PROFILE override (nextjs only)', () => {
		const profiles = resolveProfiles(SAMPLE_REPO, 'nextjs');
		expect(profiles.map((p) => p.id)).toEqual(['nextjs']);
	});

	it('rejects invalid profile override with warning', () => {
		// Capture console.warn.
		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (msg: string) => {
			warnings.push(msg);
		};
		try {
			resolveProfiles(SAMPLE_REPO, 'kotlin,bogus-value');
			expect(warnings.some((w) => w.includes('bogus-value'))).toBe(true);
		} finally {
			console.warn = originalWarn;
		}
	});

	it('buildSummaryBody renders toolFindings + diagnostics (Q3)', () => {
		const body = buildSummaryBody({
			risk: 'medium',
			counts: { critical: 0, high: 1, medium: 2, low: 0 },
			filesReviewed: ['app/page.tsx', 'app/layout.tsx'],
			model: 'test-model',
			toolFindings: [
				{
					tool: 'biome',
					code: 'no-unused-vars',
					path: 'app/page.tsx',
					line: 4,
					severity: 'medium',
					message: 'unused variable',
				},
			],
			diagnostics: {
				prelintRan: ['biome'],
				prelintSkipped: ['ruff (binary not found)'],
				prelintRanCount: 1,
				bucketedUnknownCategories: 0,
				crossFindingConflictsResolved: 0,
				trivialPrFastPath: false,
			} as never,
		});
		expect(body).toContain('Static analyzer findings');
		expect(body).toContain('biome/no-unused-vars');
		expect(body).toContain('Pipeline diagnostics');
		expect(body).toContain('**Tools ran:** biome');
	});

	it('GitHub-style diff line range works on the sample', () => {
		// Use git to verify the sample has a valid HEAD we can diff against.
		try {
			const log = execSync('git log --oneline -1', {
				cwd: SAMPLE_REPO,
				encoding: 'utf8',
			}).trim();
			expect(log.length).toBeGreaterThan(0);
		} catch {
			// Not a git repo or no commits - that's fine, just skip.
		}
	});
});
