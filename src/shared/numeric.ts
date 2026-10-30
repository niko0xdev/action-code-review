import * as core from '@actions/core';

type Bounds = { name: string; min?: number; max?: number };

function fallBack(name: string, raw: string, fallback: number): number {
	core.warning(`${name}="${raw}" is not valid – using default ${fallback}`);
	return fallback;
}

/**
 * Parse a strict positive integer (no suffixes, no decimals). Unset or blank
 * returns the fallback silently; anything invalid warns and returns the
 * fallback, so a typo can never switch a safety limit off.
 */
export function parsePositiveInt(
	raw: string | undefined,
	fallback: number,
	{ name, max }: Omit<Bounds, 'min'>
): number {
	const text = raw?.trim();
	if (!text) return fallback;
	const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
	if (!Number.isSafeInteger(value) || value < 1) {
		return fallBack(name, text, fallback);
	}
	if (max !== undefined && value > max) return fallBack(name, text, fallback);
	return value;
}

/** Parse a finite decimal within [min, max]; invalid values use the fallback. */
export function parseBoundedFloat(
	raw: string | undefined,
	fallback: number,
	{ name, min = 0, max = Number.POSITIVE_INFINITY }: Bounds
): number {
	const text = raw?.trim();
	if (!text) return fallback;
	const value = /^\d*\.?\d+$/.test(text) ? Number(text) : Number.NaN;
	if (!Number.isFinite(value) || value < min || value > max) {
		return fallBack(name, text, fallback);
	}
	return value;
}
