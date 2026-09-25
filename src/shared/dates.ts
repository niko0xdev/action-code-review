/**
 * UTC date helpers shared by review reporting.
 */

export function isoDateNow(): string {
	return new Date().toISOString();
}

export function shortIso(iso: string): string {
	return iso.slice(0, 10);
}
