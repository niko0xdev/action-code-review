import { describe, expect, it } from 'vitest';
import { groupByArea } from '../../src/context/repository.js';

describe('groupByArea', () => {
	it('groups an empty list into no areas', () => {
		expect(groupByArea([])).toEqual({});
	});

	it('routes each known area to its own bucket', () => {
		const groups = groupByArea([
			'tests/app.test.ts',
			'src/auth/login.ts',
			'src/api/routes.ts',
			'db/migration/001.sql',
			'src/components/Widget.tsx',
			'.github/workflows/ci.yml',
			'src/util.ts',
		]);
		expect(groups.tests).toEqual(['tests/app.test.ts']);
		expect(groups.auth).toEqual(['src/auth/login.ts']);
		expect(groups.api).toEqual(['src/api/routes.ts']);
		expect(groups.database).toEqual(['db/migration/001.sql']);
		expect(groups.frontend).toEqual(['src/components/Widget.tsx']);
		expect(groups.config).toEqual(['.github/workflows/ci.yml']);
		expect(groups.general).toEqual(['src/util.ts']);
	});

	it('matches areas case-insensitively', () => {
		const groups = groupByArea(['SRC/AUTH/Login.TS']);
		expect(groups.auth).toEqual(['SRC/AUTH/Login.TS']);
	});
});
