import { describe, expect, it } from 'vitest';
import { main, parseArgs } from '../src/cli.js';
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
});

describe('main (skeleton)', () => {
	it('resolves without throwing', async () => {
		await expect(main(['pr-review'])).resolves.toBeUndefined();
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
