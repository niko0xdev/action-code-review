/**
 * Hand-written pull requests for the live-model measurement. Each one adds a
 * single small file. A line ending in the `@D` marker comment carries the
 * seeded defect; the builder strips the marker before the model sees the diff
 * and records the line number. Clean cases have no marker and include code
 * that looks risky but is correct, so a model that pattern-matches scores badly.
 */

export interface LiveCase {
	id: string;
	title: string;
	body: string;
	filename: string;
	/** File content; defect lines end with the marker `/*@D*\/`. */
	source: string;
}

export const DEFECT_MARKER = '/*@D*/';

export const LIVE_CASES: readonly LiveCase[] = [
	// --- Seeded defects ---------------------------------------------------
	{
		id: 'bug-off-by-one',
		title: 'Add total helper',
		body: 'Sums the line totals of an order.',
		filename: 'src/order-total.ts',
		source: `export interface Line {
	price: number;
	quantity: number;
}

export function orderTotal(lines: Line[]): number {
	let total = 0;
	for (let i = 0; i <= lines.length; i++) { ${DEFECT_MARKER}
		total += lines[i].price * lines[i].quantity;
	}
	return total;
}
`,
	},
	{
		id: 'bug-sql-injection',
		title: 'Look up users by name',
		body: 'Adds a lookup used by the admin search box.',
		filename: 'src/user-repo.ts',
		source: `import type { Pool } from 'pg';

export async function findUsersByName(pool: Pool, name: string) {
	const sql = "SELECT id, name, email FROM users WHERE name = '" + name + "'"; ${DEFECT_MARKER}
	const result = await pool.query(sql);
	return result.rows;
}
`,
	},
	{
		id: 'bug-missing-await',
		title: 'Persist settings before replying',
		body: 'Saves the settings and tells the client it worked.',
		filename: 'src/settings-handler.ts',
		source: `import type { Request, Response } from 'express';
import { saveSettings } from './store.js';

export async function updateSettings(req: Request, res: Response) {
	try {
		saveSettings(req.params.userId, req.body); ${DEFECT_MARKER}
		res.status(200).json({ saved: true });
	} catch (error) {
		res.status(500).json({ saved: false });
	}
}
`,
	},
	{
		id: 'bug-assignment-in-condition',
		title: 'Gate the audit export',
		body: 'Only administrators may export the audit log.',
		filename: 'src/audit-export.ts',
		source: `export interface User {
	id: string;
	role: 'admin' | 'member';
}

export function canExportAudit(user: User): boolean {
	if ((user.role = 'admin')) { ${DEFECT_MARKER}
		return true;
	}
	return false;
}
`,
	},
	{
		id: 'bug-path-traversal',
		title: 'Serve uploaded avatars',
		body: 'Streams a file from the uploads directory.',
		filename: 'src/avatar-route.ts',
		source: `import { join } from 'node:path';
import type { Request, Response } from 'express';

const UPLOADS = '/var/app/uploads';

export function avatar(req: Request, res: Response) {
	const file = String(req.query.file);
	res.sendFile(join(UPLOADS, file)); ${DEFECT_MARKER}
}
`,
	},
	{
		id: 'bug-null-dereference',
		title: 'Show the owner name',
		body: 'Displays the owner on the project page.',
		filename: 'src/owner-name.ts',
		source: `export interface Member {
	id: string;
	name: string;
}

export function ownerName(members: Member[], ownerId: string): string {
	return members.find((m) => m.id === ownerId).name; ${DEFECT_MARKER}
}
`,
	},
	{
		id: 'bug-pagination-offset',
		title: 'Paginate the invoice list',
		body: 'Pages are 1-based in the API.',
		filename: 'src/invoice-page.ts',
		source: `export function pageOffset(page: number, pageSize: number): number {
	return page * pageSize; ${DEFECT_MARKER}
}

export function invoicePage<T>(all: T[], page: number, pageSize: number): T[] {
	const offset = pageOffset(page, pageSize);
	return all.slice(offset, offset + pageSize);
}
`,
	},
	{
		id: 'bug-string-date-compare',
		title: 'Expire stale sessions',
		body: 'Sessions store expiry as an ISO-8601 string.',
		filename: 'src/session-expiry.ts',
		source: `export interface Session {
	id: string;
	expiresAt: string;
}

export function isExpired(session: Session, now: number): boolean {
	return session.expiresAt < now; ${DEFECT_MARKER}
}
`,
	},
	{
		id: 'bug-swallowed-error',
		title: 'Charge the customer',
		body: 'Returns whether the charge went through.',
		filename: 'src/charge.ts',
		source: `export interface Gateway {
	charge(customerId: string, cents: number): Promise<void>;
}

export async function chargeCustomer(
	gateway: Gateway,
	customerId: string,
	cents: number
): Promise<boolean> {
	try {
		await gateway.charge(customerId, cents);
	} catch {
		// ignore
	}
	return true; ${DEFECT_MARKER}
}
`,
	},
	{
		id: 'bug-shared-cache-key',
		title: 'Cache price lookups',
		body: 'Speeds up repeated price lookups per currency.',
		filename: 'src/price-cache.ts',
		source: `const cache = new Map<string, number>();

export async function priceFor(
	sku: string,
	currency: string,
	fetchPrice: (sku: string, currency: string) => Promise<number>
): Promise<number> {
	const hit = cache.get(sku); ${DEFECT_MARKER}
	if (hit !== undefined) return hit;
	const price = await fetchPrice(sku, currency);
	cache.set(sku, price);
	return price;
}
`,
	},

	// --- Clean PRs (some deliberately look risky) -------------------------
	{
		id: 'clean-bounded-loop',
		title: 'Add average helper',
		body: 'Mean of a list of numbers, 0 for an empty list.',
		filename: 'src/average.ts',
		source: `export function average(values: number[]): number {
	if (values.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
	}
	return sum / values.length;
}
`,
	},
	{
		id: 'clean-parameterised-query',
		title: 'Look up users by name',
		body: 'Adds a lookup used by the admin search box.',
		filename: 'src/user-repo.ts',
		source: `import type { Pool } from 'pg';

export async function findUsersByName(pool: Pool, name: string) {
	const result = await pool.query(
		'SELECT id, name, email FROM users WHERE name = $1',
		[name]
	);
	return result.rows;
}
`,
	},
	{
		id: 'clean-awaited-save',
		title: 'Persist settings before replying',
		body: 'Saves the settings and tells the client it worked.',
		filename: 'src/settings-handler.ts',
		source: `import type { Request, Response } from 'express';
import { saveSettings } from './store.js';

export async function updateSettings(req: Request, res: Response) {
	try {
		await saveSettings(req.params.userId, req.body);
		res.status(200).json({ saved: true });
	} catch (error) {
		res.status(500).json({ saved: false });
	}
}
`,
	},
	{
		id: 'clean-contained-path',
		title: 'Serve uploaded avatars',
		body: 'Streams a file from the uploads directory, refusing anything outside it.',
		filename: 'src/avatar-route.ts',
		source: `import { resolve, sep } from 'node:path';
import type { Request, Response } from 'express';

const UPLOADS = resolve('/var/app/uploads');

export function avatar(req: Request, res: Response) {
	const target = resolve(UPLOADS, String(req.query.file));
	if (!target.startsWith(UPLOADS + sep)) {
		res.status(400).end();
		return;
	}
	res.sendFile(target);
}
`,
	},
	{
		id: 'clean-guarded-find',
		title: 'Show the owner name',
		body: 'Displays the owner on the project page; falls back to "Unknown".',
		filename: 'src/owner-name.ts',
		source: `export interface Member {
	id: string;
	name: string;
}

export function ownerName(members: Member[], ownerId: string): string {
	return members.find((m) => m.id === ownerId)?.name ?? 'Unknown';
}
`,
	},
	{
		id: 'clean-one-based-page',
		title: 'Paginate the invoice list',
		body: 'Pages are 1-based in the API.',
		filename: 'src/invoice-page.ts',
		source: `export function pageOffset(page: number, pageSize: number): number {
	return (Math.max(page, 1) - 1) * pageSize;
}

export function invoicePage<T>(all: T[], page: number, pageSize: number): T[] {
	const offset = pageOffset(page, pageSize);
	return all.slice(offset, offset + pageSize);
}
`,
	},
	{
		id: 'clean-date-compare',
		title: 'Expire stale sessions',
		body: 'Sessions store expiry as an ISO-8601 string.',
		filename: 'src/session-expiry.ts',
		source: `export interface Session {
	id: string;
	expiresAt: string;
}

export function isExpired(session: Session, now: number): boolean {
	return Date.parse(session.expiresAt) < now;
}
`,
	},
	{
		id: 'clean-rethrow',
		title: 'Charge the customer',
		body: 'Returns true on success and lets failures propagate to the caller.',
		filename: 'src/charge.ts',
		source: `export interface Gateway {
	charge(customerId: string, cents: number): Promise<void>;
}

export async function chargeCustomer(
	gateway: Gateway,
	customerId: string,
	cents: number
): Promise<boolean> {
	try {
		await gateway.charge(customerId, cents);
	} catch (error) {
		throw new Error(\`charge failed for \${customerId}\`, { cause: error });
	}
	return true;
}
`,
	},
	{
		id: 'clean-composite-cache-key',
		title: 'Cache price lookups',
		body: 'Speeds up repeated price lookups per currency.',
		filename: 'src/price-cache.ts',
		source: `const cache = new Map<string, number>();

export async function priceFor(
	sku: string,
	currency: string,
	fetchPrice: (sku: string, currency: string) => Promise<number>
): Promise<number> {
	const key = \`\${sku}:\${currency}\`;
	const hit = cache.get(key);
	if (hit !== undefined) return hit;
	const price = await fetchPrice(sku, currency);
	cache.set(key, price);
	return price;
}
`,
	},
	{
		id: 'clean-intentional-loose-equality',
		title: 'Match optional ids',
		body: 'Treats null and undefined ids as equal on purpose.',
		filename: 'src/same-id.ts',
		source: `/** Both missing counts as a match; \`== null\` covers null and undefined. */
export function sameId(a: string | null | undefined, b: string | null | undefined): boolean {
	if (a == null && b == null) return true;
	return a === b;
}
`,
	},
];
