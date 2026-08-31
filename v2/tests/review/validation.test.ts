import { describe, expect, it } from 'vitest';
import {
	ALLOWED_CATEGORIES,
	FALLBACK_CATEGORY,
	LINE_PROXIMITY,
	TRIVIAL_DIFF_LINE_THRESHOLD,
	TRIVIAL_MAX_FINDINGS,
	hasTestFileChanges,
	normalizeCategories,
	resolveCrossFindingConflicts,
	sanitizeReplacements,
	trivialPrFastPath,
} from '../../src/review/validation.js';
import type { Finding } from '../../src/types/finding.js';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		severity: 'medium',
		confidence: 0.9,
		category: 'correctness',
		path: 'src/app.ts',
		line: 10,
		title: 'Bug found',
		description: 'Something is broken.',
		impact: 'Will fail at runtime.',
		...overrides,
	};
}

describe('ALLOWED_CATEGORIES', () => {
	it('matches the FindingCategory union', () => {
		expect(ALLOWED_CATEGORIES).toEqual([
			'correctness',
			'security',
			'regression',
			'error-handling',
			'data-integrity',
			'concurrency',
			'performance',
			'maintainability',
			'testing',
			'compatibility',
		]);
	});
});

describe('normalizeCategories', () => {
	it('keeps allowed categories unchanged', () => {
		const findings = [
			mkFinding({ category: 'correctness' }),
			mkFinding({ category: 'security' }),
		];
		const result = normalizeCategories(findings);
		expect(result.findings).toEqual(findings);
		expect(result.bucketedCount).toBe(0);
	});

	it('buckets unknown categories to low + maintainability', () => {
		const findings = [
			mkFinding({ category: 'correctness' as Finding['category'] }),
			mkFinding({ category: 'code-smell' as Finding['category'] }),
			mkFinding({ category: 'docs' as Finding['category'] }),
		];
		const result = normalizeCategories(findings);
		expect(result.bucketedCount).toBe(2);
		expect(result.findings[0]?.category).toBe('correctness');
		expect(result.findings[1]?.category).toBe(FALLBACK_CATEGORY);
		expect(result.findings[1]?.severity).toBe('low');
		expect(result.findings[2]?.category).toBe(FALLBACK_CATEGORY);
		expect(result.findings[2]?.severity).toBe('low');
	});

	it('preserves other fields when bucketing', () => {
		const original = mkFinding({
			category: 'smelly' as Finding['category'],
			path: 'src/foo.ts',
			line: 42,
			confidence: 0.95,
			title: 'Original intent',
			description: 'Original description',
		});
		const result = normalizeCategories([original]);
		expect(result.findings[0]).toMatchObject({
			path: 'src/foo.ts',
			line: 42,
			confidence: 0.95,
			title: 'Original intent',
			description: 'Original description',
		});
	});

	it('handles empty input', () => {
		const result = normalizeCategories([]);
		expect(result.findings).toEqual([]);
		expect(result.bucketedCount).toBe(0);
	});
});

describe('sanitizeReplacements', () => {
	it('keeps clean replacements', () => {
		const finding = mkFinding({ replacement: 'const x = 1;' });
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBe('const x = 1;');
	});

	it('strips empty replacement', () => {
		const finding = mkFinding({ replacement: '   ' });
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeNull();
	});

	it('strips merge-conflict markers', () => {
		const finding = mkFinding({
			replacement: '<<<<<<< HEAD\nfoo\n=======\nbar',
		});
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeNull();
	});

	it('strips unbalanced braces', () => {
		const finding = mkFinding({
			replacement: 'function foo() { if (true) { return 1;',
		});
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeNull();
	});

	it('strips unbalanced brackets', () => {
		const finding = mkFinding({
			replacement: 'const arr = [1, 2, 3;',
		});
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeNull();
	});

	it('strips unbalanced parens', () => {
		const finding = mkFinding({ replacement: 'foo(bar(' });
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeNull();
	});

	it('keeps balanced nested delimiters', () => {
		const finding = mkFinding({
			replacement: 'function foo() { return [1, 2, { x: (3) }]; }',
		});
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBe(
			'function foo() { return [1, 2, { x: (3) }]; }'
		);
	});

	it('keeps strings + comments balanced', () => {
		const finding = mkFinding({
			replacement:
				'const x = "hello {world}"; // {not real}\nconst y = `t${1}`;',
		});
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBe(
			'const x = "hello {world}"; // {not real}\nconst y = `t${1}`;'
		);
	});

	it('keeps undefined replacement untouched', () => {
		const finding = mkFinding({ replacement: undefined });
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeUndefined();
	});

	it('keeps null replacement untouched', () => {
		const finding = mkFinding({ replacement: null });
		const result = sanitizeReplacements([finding]);
		expect(result[0]?.replacement).toBeNull();
	});
});

describe('resolveCrossFindingConflicts', () => {
	it('keeps findings on different paths', () => {
		const findings = [
			mkFinding({ path: 'src/a.ts', line: 10 }),
			mkFinding({ path: 'src/b.ts', line: 10 }),
		];
		const result = resolveCrossFindingConflicts(findings);
		expect(result.findings).toHaveLength(2);
		expect(result.droppedCount).toBe(0);
	});

	it('keeps findings with different categories even when close in line', () => {
		const findings = [
			mkFinding({ category: 'correctness', line: 10 }),
			mkFinding({ category: 'security', line: 12 }),
		];
		const result = resolveCrossFindingConflicts(findings);
		expect(result.findings).toHaveLength(2);
		expect(result.droppedCount).toBe(0);
	});

	it('drops contradictory finding in same path+category within proximity', () => {
		const findings = [
			mkFinding({
				category: 'correctness',
				line: 10,
				confidence: 0.7,
				title: 'Missing error handling',
				description: 'You should add a try/catch here.',
			}),
			mkFinding({
				category: 'correctness',
				line: 12,
				confidence: 0.95,
				title: 'Remove redundant try/catch',
				description: 'This try/catch is unnecessary, can be removed.',
			}),
		];
		const result = resolveCrossFindingConflicts(findings);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.confidence).toBe(0.95);
		expect(result.droppedCount).toBe(1);
	});

	it('does not flag non-contradictory findings within proximity', () => {
		const findings = [
			mkFinding({
				category: 'correctness',
				line: 10,
				title: 'Missing validation',
				description: 'Add input validation.',
			}),
			mkFinding({
				category: 'correctness',
				line: 12,
				title: 'Performance issue',
				description: 'This loop is slow.',
			}),
		];
		const result = resolveCrossFindingConflicts(findings);
		expect(result.findings).toHaveLength(2);
		expect(result.droppedCount).toBe(0);
	});

	it('does not flag findings further apart than LINE_PROXIMITY', () => {
		const findings = [
			mkFinding({
				category: 'correctness',
				line: 10,
				title: 'Missing validation',
				description: 'Add input validation.',
			}),
			mkFinding({
				category: 'correctness',
				line: 10 + LINE_PROXIMITY + 5,
				title: 'Remove redundant code',
				description: 'This can be removed.',
			}),
		];
		const result = resolveCrossFindingConflicts(findings);
		expect(result.findings).toHaveLength(2);
		expect(result.droppedCount).toBe(0);
	});

	it('keeps higher-confidence finding when in same group', () => {
		const findings = [
			mkFinding({
				category: 'security',
				line: 5,
				confidence: 0.6,
				title: 'Should add auth check',
				description: 'Must require auth.',
			}),
			mkFinding({
				category: 'security',
				line: 8,
				confidence: 0.85,
				title: 'Remove unused auth check',
				description: 'Remove this redundant auth check.',
			}),
		];
		const result = resolveCrossFindingConflicts(findings);
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.confidence).toBe(0.85);
	});
});

describe('trivialPrFastPath', () => {
	const findings = [
		mkFinding({ severity: 'low', confidence: 0.9 }),
		mkFinding({ severity: 'medium', confidence: 0.8 }),
		mkFinding({ severity: 'high', confidence: 0.7 }),
		mkFinding({ severity: 'critical', confidence: 0.6 }),
		mkFinding({ severity: 'low', confidence: 0.95 }),
	];

	it('does not apply when totalChanges >= threshold', () => {
		const result = trivialPrFastPath(findings, {
			totalChanges: TRIVIAL_DIFF_LINE_THRESHOLD,
			hasTestFileChanges: false,
		});
		expect(result.trivialPr).toBe(false);
		expect(result.findings).toHaveLength(findings.length);
	});

	it('does not apply when test file is changed', () => {
		const result = trivialPrFastPath(findings, {
			totalChanges: 3,
			hasTestFileChanges: true,
		});
		expect(result.trivialPr).toBe(false);
		expect(result.findings).toHaveLength(findings.length);
	});

	it('caps findings when totalChanges < threshold and no test changes', () => {
		const result = trivialPrFastPath(findings, {
			totalChanges: 3,
			hasTestFileChanges: false,
		});
		expect(result.trivialPr).toBe(true);
		expect(result.findings).toHaveLength(TRIVIAL_MAX_FINDINGS);
	});

	it('caps by severity rank first, then confidence', () => {
		const result = trivialPrFastPath(findings, {
			totalChanges: 2,
			hasTestFileChanges: false,
		});
		const top3 = result.findings;
		// Severity order: critical > high > medium > low.
		// findings[0]=low/0.9, [1]=medium/0.8, [2]=high/0.7, [3]=critical/0.6, [4]=low/0.95.
		// Sorted by severity-desc then confidence-desc:
		//   critical (0.6) > high (0.7) > medium (0.8) > low (0.95) > low (0.9).
		expect(top3[0]?.severity).toBe('critical');
		expect(top3[1]?.severity).toBe('high');
		expect(top3[2]?.severity).toBe('medium');
		expect(top3[2]?.confidence).toBe(0.8);
	});

	it('handles empty findings', () => {
		const result = trivialPrFastPath([], {
			totalChanges: 2,
			hasTestFileChanges: false,
		});
		expect(result.trivialPr).toBe(true);
		expect(result.findings).toEqual([]);
	});
});

describe('hasTestFileChanges', () => {
	it('detects .test.ts files', () => {
		expect(hasTestFileChanges(['src/app.test.ts'])).toBe(true);
	});

	it('detects .spec.ts files', () => {
		expect(hasTestFileChanges(['src/app.spec.tsx'])).toBe(true);
	});

	it('detects __tests__ directories', () => {
		expect(hasTestFileChanges(['src/__tests__/foo.ts'])).toBe(true);
	});

	it('detects test_ prefix Python files', () => {
		expect(hasTestFileChanges(['test_app.py'])).toBe(true);
	});

	it('detects _test.go suffix', () => {
		expect(hasTestFileChanges(['pkg/foo_test.go'])).toBe(true);
	});

	it('detects top-level test/ directories', () => {
		expect(hasTestFileChanges(['test/foo.ts'])).toBe(true);
		expect(hasTestFileChanges(['tests/foo.ts'])).toBe(true);
	});

	it('does NOT flag nested test-utils', () => {
		// Common monorepo pattern: src/test-utils/helpers.ts - not a test file.
		expect(hasTestFileChanges(['src/test-utils/helpers.ts'])).toBe(false);
	});

	it('does NOT flag non-test files', () => {
		expect(hasTestFileChanges(['src/app.ts', 'README.md'])).toBe(false);
	});
});
