import { describe, expect, it } from 'vitest';
import { resolveV2Entry } from '../v2Delegate';

describe('V2 delegation bridge', () => {
	it('resolves bundled entry from repository root', () => {
		expect(resolveV2Entry(process.cwd())).toMatch(
			/v2[\\/]dist[\\/]entry[\\/]pr-content\.js$/
		);
	});

	it('falls through when V2 bundle is absent', () => {
		expect(resolveV2Entry('/tmp/does-not-exist')).toBeNull();
	});
});
