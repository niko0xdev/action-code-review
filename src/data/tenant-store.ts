/** Load a PostgreSQL record in the authenticated tenant supplied by the caller. */
export async function findTenantRecord(
	database: { query(sql: string, parameters: string[]): Promise<unknown> },
	request: { tenantId: string; recordId: string }
): Promise<unknown> {
	return database.query(
		'SELECT * FROM records WHERE tenant_id = $1 AND id = $2',
		[request.tenantId, request.recordId]
	);
}
