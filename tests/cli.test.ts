import { describe, expect, it, vi } from 'vitest';
import { applyLegacyFilters, main, parseArgs } from '../src/cli.js';

import {
	FINDING_LIMITS,
	SEVERITY_ORDER,
	type Severity,
} from '../src/types/finding.js';

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
