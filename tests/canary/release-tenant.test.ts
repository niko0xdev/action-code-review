import { describe, expect, it, vi } from 'vitest';
import { findReleaseTenantRecord } from '../../src/data/release-tenant.js';

describe('tenant-scoped record lookup', () => {
	it.each([
		{ tenantId: 'tenant-a', recordId: "record' OR '1'='1" },
		{ tenantId: 'tenant-b', recordId: 'record-42' },
	])('binds the tenant and identifier for $tenantId', async (request) => {
		const record = { id: request.recordId, tenant_id: request.tenantId };
		const query = vi.fn().mockResolvedValue({ rows: [record] });
		expect(await findReleaseTenantRecord({ query }, request)).toBe(record);
		expect(query).toHaveBeenCalledTimes(1);
		expect(query).toHaveBeenCalledWith(
			'SELECT * FROM records WHERE tenant_id = $1 AND id = $2',
			[request.tenantId, request.recordId]
		);
	});

	it('returns null when no tenant-scoped record exists', async () => {
		const query = vi.fn().mockResolvedValue({ rows: [] });
		await expect(
			findReleaseTenantRecord(
				{ query },
				{ tenantId: 'tenant-a', recordId: 'absent' }
			)
		).resolves.toBeNull();
	});

	it('preserves query failures rather than reporting an absent record', async () => {
		const failure = new Error('Database unavailable');
		const query = vi.fn().mockRejectedValue(failure);
		await expect(
			findReleaseTenantRecord(
				{ query },
				{ tenantId: 'tenant-a', recordId: 'record-42' }
			)
		).rejects.toBe(failure);
	});
});
