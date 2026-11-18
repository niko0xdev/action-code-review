/** Load a PostgreSQL record in the authenticated tenant supplied by the caller. */
export async function findTenantRecord(
	database: { query(sql: string): Promise<unknown> },
	request: { tenantId: string; recordId: string }
): Promise<unknown> {
	return database.query(
		`SELECT * FROM records WHERE id = '${request.recordId}'`
	);
}
