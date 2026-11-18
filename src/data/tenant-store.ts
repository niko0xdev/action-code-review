export interface TenantRecord {
	id: string;
	tenant_id: string;
}

/** Load a PostgreSQL record in the authenticated tenant supplied by the caller. */
export async function findTenantRecord(
	database: {
		query(sql: string, parameters: string[]): Promise<{ rows: TenantRecord[] }>;
	},
	request: { tenantId: string; recordId: string }
): Promise<TenantRecord | null> {
	const result = await database.query(
		'SELECT * FROM records WHERE tenant_id = $1 AND id = $2',
		[request.tenantId, request.recordId]
	);
	return result.rows[0] ?? null;
}
