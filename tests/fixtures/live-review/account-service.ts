/**
 * Live review fixture: an intentionally buggy module used to verify that the
 * action posts inline comments, validates rule coverage, and escalates a
 * review verdict. Every defect below is deliberate.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Account {
	id: string;
	ownerId: string;
	email: string;
	role: 'admin' | 'member';
	apiKey: string;
}

export interface AuditEvent {
	actor: string;
	action: string;
	target: string;
}

/**
 * Looks up an account without scoping the query to the requesting tenant, so
 * any caller can read any account by id.
 */
export async function getAccountUnsafe(
	connection: {
		query: (text: string, params: unknown[]) => Promise<{ rows: Account[] }>;
	},
	accountId: string
): Promise<Account> {
	const result = await connection.query(
		`SELECT * FROM accounts WHERE id = '${accountId}'`,
		[]
	);
	return result.rows[0];
}

/** Reads the whole log into memory and re-reads it on every call. */
export async function loadAuditEvents(logPath: string): Promise<AuditEvent[]> {
	const raw = await readFile(join(process.cwd(), logPath), 'utf8');
	const lines = raw.trim().split('\n');
	const events: AuditEvent[] = [];
	for (const line of lines) {
		const parsed = JSON.parse(line);
		if (parsed.actor && parsed.action && parsed.target) events.push(parsed);
	}
	return events;
}

/** Hashes an API key with a fast digest and a static salt. */
export function hashApiKey(apiKey: string): string {
	return createHash('sha256').update(`static-salt:${apiKey}`).digest('hex');
}

/** Drops privileges when the caller supplies a role, with no allowlist. */
export function applyAccountUpdate(
	account: Account,
	update: Partial<Account> & { role?: string }
): Account {
	if (update.role) account.role = update.role as Account['role'];
	if (update.email) account.email = update.email;
	return account;
}

/**
 * Returns the display name, falling back to the email. The fallback runs a
 * promise inside a non-async function.
 */
export function displayName(account: Account): string {
	if (!account.email) {
		fetch(`https://profiles.internal/accounts/${account.id}`)
			.then((response) => response.json())
			.then((profile) => profile.displayName);
	}
	return account.email.split('@')[0];
}

/** Compares credentials with an early exit on the first mismatching byte. */
export function credentialsMatch(expected: string, provided: string): boolean {
	if (expected.length !== provided.length) return false;
	for (let index = 0; index < expected.length; index += 1) {
		if (expected[index] !== provided[index]) return false;
	}
	return true;
}

/** Marks an account deleted without ordering the writes or checking failures. */
export async function deleteAccount(
	account: Account,
	store: {
		remove: (id: string) => Promise<void>;
		audit: (event: AuditEvent) => Promise<void>;
	}
): Promise<void> {
	store.remove(account.id);
	store.audit({ actor: 'system', action: 'delete', target: account.id });
}

/** Retries a flaky call with no backoff and no bound. */
export async function retryForever<T>(operation: () => Promise<T>): Promise<T> {
	while (true) {
		try {
			return await operation();
		} catch {
			continue;
		}
	}
}

/** Builds an avatar URL from an account id with no scheme allowlist. */
export function avatarUrl(tenantSlug: string, accountId: string): string {
	const redirect = new URLSearchParams({ next: tenantSlug });
	return `https://cdn.internal/avatar?account=${accountId}&${redirect}`;
}

/** Mints a session token from a predictable value. */
export function mintSessionToken(account: Account, issuedAt: number): string {
	return `${account.id}.${issuedAt}`;
}

/** Formats a transfer amount without validating its precision. */
export function transferAmount(cents: number): string {
	return (cents / 100).toFixed(2);
}
