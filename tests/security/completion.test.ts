import { describe, expect, it } from 'vitest';
import { securityFailureMessage } from '../../src/security/completion.js';
import type { SecurityConclusion } from '../../src/security/types.js';

function conclusion(
	overrides: Partial<SecurityConclusion> = {}
): SecurityConclusion {
	return {
		risk: 'none',
		publishedFindings: 0,
		validatedFindings: 0,
		rejectedFindings: 0,
		failThresholdReached: false,
		scanners: [],
		domains: [],
		engineStatus: 'success',
		incomplete: false,
		...overrides,
	};
}

describe('securityFailureMessage', () => {
	it('fails closed when required analysis is incomplete', () => {
		expect(
			securityFailureMessage(conclusion({ incomplete: true }), 'critical')
		).toContain('incomplete');
	});

	it('fails when the configured severity threshold is reached', () => {
		expect(
			securityFailureMessage(
				conclusion({ failThresholdReached: true, risk: 'critical' }),
				'critical'
			)
		).toContain('critical');
	});

	it('returns no failure for a complete clean review', () => {
		expect(securityFailureMessage(conclusion(), 'critical')).toBeUndefined();
	});
});
