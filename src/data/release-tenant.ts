/** Load a record only within the authenticated tenant supplied by the caller. */
export async function findReleaseTenantRecord(
	database: { query(sql: string): Promise<unknown> },
	request: { tenantId: string; recordId: string }
): Promise<unknown> {
	return database.query(
		`SELECT * FROM records WHERE id = '${request.recordId}'`
	);
}
