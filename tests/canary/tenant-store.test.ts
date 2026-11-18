import { describe, expect, it, vi } from 'vitest';
import { findTenantRecord } from '../../src/data/tenant-store.js';

describe('tenant-scoped record lookup', () => {
	it.each([
		{ tenantId: 'tenant-a', recordId: "record' OR '1'='1" },
		{ tenantId: 'tenant-b', recordId: 'record-42' },
	])('binds the tenant and identifier for $tenantId', async (request) => {
		const record = { id: request.recordId, tenantId: request.tenantId };
		const query = vi.fn().mockResolvedValue(record);
		expect(await findTenantRecord({ query }, request)).toBe(record);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(
			'SELECT * FROM records WHERE tenant_id = $1 AND id = $2',
			[request.tenantId, request.recordId]
		);
	});
});
