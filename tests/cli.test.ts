import * as core from '@actions/core';
import { describe, expect, it, vi } from 'vitest';
import {
	applyLegacyFilters,
	classifyEmptySelection,
	escalateMaxTokens,
	main,
	normalizeIncludeDir,
	parseArgs,
	readReviewEnvLimits,
} from '../src/cli.js';

import {
	FINDING_LIMITS,
	SEVERITY_ORDER,
	type Severity,
} from '../src/types/finding.js';

describe('escalateMaxTokens', () => {
	it('doubles the budget', () => {
		expect(escalateMaxTokens(4096)).toBe(8192);
		expect(escalateMaxTokens(8192)).toBe(16384);
	});

	it('stops at the ceiling', () => {
		expect(escalateMaxTokens(16384)).toBe(32768);
		expect(escalateMaxTokens(32768)).toBe(32768);
		expect(escalateMaxTokens(100000)).toBe(32768);
	});
});

describe('parseArgs', () => {
	it('selects pr-review by default', () => {
		expect(parseArgs([]).action).toBe('pr-review');
	});

	it('accepts pr-content as the action argument', () => {
		expect(parseArgs(['pr-content']).action).toBe('pr-content');
	});

	it('falls back to pr-review for unknown arguments', () => {
		expect(parseArgs(['unknown']).action).toBe('pr-review');
	});

	it('anchors exclude patterns and compiles them once', () => {
		const result = applyLegacyFilters(
			['src/a.ts', 'src/a.ts.bak', 'docs/a.ts'],
			{ excludePatterns: ['src/*.ts'] }
		);
		expect(result).toEqual(['src/a.ts.bak', 'docs/a.ts']);
	});

	it('treats ? in exclude patterns literally instead of throwing', () => {
		expect(
			applyLegacyFilters(['a?.ts', 'ab.ts'], { excludePatterns: ['a?.ts'] })
		).toEqual(['ab.ts']);
	});

	it.each(['./src', 'src/', './src/', 'src\\', '.\\src'])(
		'normalises include-dir %s',
		(dir) => {
			expect(
				applyLegacyFilters(['src/a.ts', 'docs/b.ts'], {
					excludePatterns: [],
					includeDirs: [dir],
				})
			).toEqual(['src/a.ts']);
		}
	);

	it('warns when an include-dir matches no files', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		applyLegacyFilters(['src/a.ts'], {
			excludePatterns: [],
			includeDirs: ['lib'],
		});
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('lib'));
		warn.mockRestore();
	});

	it('compiles each exclude pattern once for all filenames', () => {
		const original = RegExp;
		let calls = 0;
		const spy = vi.spyOn(globalThis, 'RegExp').mockImplementation((...args) => {
			calls += 1;
			return new original(...args);
		});
		try {
			applyLegacyFilters(['a.ts', 'b.ts', 'c.ts'], {
				excludePatterns: ['*.ts', '*.md'],
			});
			expect(calls).toBe(2);
		} finally {
			spy.mockRestore();
		}
	});

	it('keeps pr-content metadata author explicit', async () => {
		const { readFile } = await import('node:fs/promises');
		const action = await readFile(
			new URL('../pr-content/action.yml', import.meta.url),
			'utf8'
		);
		expect(action).toContain("author: 'niko0xdev'");
	});
});

describe('include-dir hardening', () => {
	it('strips leading slashes', () => {
		expect(normalizeIncludeDir('/src')).toBe('src');
		expect(normalizeIncludeDir('//src/')).toBe('src');
		expect(
			applyLegacyFilters(['src/a.ts', 'docs/b.ts'], {
				excludePatterns: [],
				includeDirs: ['/src'],
			})
		).toEqual(['src/a.ts']);
	});

	it.each(['../src', 'src/../docs', '/..'])(
		'treats %s as non-matching and warns',
		(dir) => {
			const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
			expect(
				applyLegacyFilters(['src/a.ts', 'docs/b.ts', 'a.ts'], {
					excludePatterns: [],
					includeDirs: [dir],
				})
			).toEqual([]);
			expect(warn).toHaveBeenCalledWith(expect.stringContaining('..'));
			warn.mockRestore();
		}
	);

	it('still honours valid include-dirs next to an invalid one', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		expect(
			applyLegacyFilters(['src/a.ts', 'docs/b.ts'], {
				excludePatterns: [],
				includeDirs: ['../x', 'src'],
			})
		).toEqual(['src/a.ts']);
		warn.mockRestore();
	});
});

describe('classifyEmptySelection', () => {
	const base = {
		filesTotal: 1,
		filteredCount: 1,
		excludePatterns: ['*.md', '*.txt'],
	};

	it('is a notice for a legitimate empty selection such as a lockfile-only PR', () => {
		expect(classifyEmptySelection(base)).toBe('notice');
	});

	it('is a notice for a docs-only PR hidden by the default exclude patterns', () => {
		expect(classifyEmptySelection({ ...base, filteredCount: 0 })).toBe(
			'notice'
		);
	});

	it('warns when an include-dir matched nothing', () => {
		expect(
			classifyEmptySelection({
				...base,
				filteredCount: 0,
				includeDirs: ['lib'],
			})
		).toBe('warning');
	});

	it('warns when custom exclude patterns removed every file', () => {
		expect(
			classifyEmptySelection({
				...base,
				filteredCount: 0,
				excludePatterns: ['src/*'],
			})
		).toBe('warning');
	});
});

describe('readReviewEnvLimits', () => {
	it('uses defaults when unset', () => {
		const limits = readReviewEnvLimits({});
		expect(limits.maxFiles).toBe(100);
		expect(limits.minConfidence).toBe(0.8);
		expect(limits.verifyBudgetUsd).toBe(0.5);
	});

	it('reads valid values', () => {
		expect(
			readReviewEnvLimits({
				AI_REVIEW_MAX_FILES: '25',
				AI_REVIEW_MIN_CONFIDENCE: '0.5',
				AI_REVIEW_VERIFY_BUDGET_USD: '1.25',
			})
		).toEqual({ maxFiles: 25, minConfidence: 0.5, verifyBudgetUsd: 1.25 });
	});

	it('warns and falls back for invalid values', () => {
		const warn = vi.spyOn(core, 'warning').mockImplementation(() => {});
		const limits = readReviewEnvLimits({
			AI_REVIEW_MAX_FILES: 'lots',
			AI_REVIEW_MIN_CONFIDENCE: '1.5',
			AI_REVIEW_VERIFY_BUDGET_USD: '-1',
		});
		expect(limits).toEqual({
			maxFiles: 100,
			minConfidence: 0.8,
			verifyBudgetUsd: 0.5,
		});
		for (const name of [
			'AI_REVIEW_MAX_FILES',
			'AI_REVIEW_MIN_CONFIDENCE',
			'AI_REVIEW_VERIFY_BUDGET_USD',
		])
			expect(warn).toHaveBeenCalledWith(expect.stringContaining(name));
		warn.mockRestore();
	});
});

describe('main (skeleton)', () => {
	it('resolves without throwing', async () => {
		await expect(main(['pr-review'])).resolves.toBeUndefined();
	});

	it('dispatches pr-content without throwing outside a pull request', async () => {
		await expect(main(['pr-content'])).resolves.toBeUndefined();
	});
});

describe('finding model invariants', () => {
	const severities: Severity[] = ['critical', 'high', 'medium', 'low'];

	it('orders severity ranks strictly descending from critical to low', () => {
		for (let i = 1; i < severities.length; i++) {
			expect(SEVERITY_ORDER[severities[i - 1]]).toBeGreaterThan(
				SEVERITY_ORDER[severities[i]]
			);
		}
	});

	it('caps overall findings at 20 per spec §19', () => {
		expect(FINDING_LIMITS.overall).toBe(20);
	});

	it('keeps per-severity caps within the overall cap', () => {
		for (const severity of severities) {
			expect(FINDING_LIMITS[severity]).toBeLessThanOrEqual(
				FINDING_LIMITS.overall
			);
		}
	});
});
