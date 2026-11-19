import { describe, expect, it } from 'vitest';
import { confirmationSnippet } from '../../src/security/engines/pi-security-engine.js';

function hunk(start: number, lines: string[]): string {
	return [`@@ -${start},0 +${start},${lines.length} @@`, ...lines].join('\n');
}

describe('confirmationSnippet', () => {
	it('supplies the hunk containing the claimed line, however late in the patch', () => {
		const filler = Array.from(
			{ length: 200 },
			(_, i) => `+const pad${i} = ${'x'.repeat(30)};`
		);
		const patch = [
			hunk(1, filler),
			hunk(500, [
				'+const id = req.query.id;',
				'+db.query(`SELECT * WHERE id=${id}`);',
			]),
		].join('\n');
		expect(patch.length).toBeGreaterThan(5000);
		const snippet = confirmationSnippet(patch, 501, 501, 5000);
		expect(snippet).toContain('db.query(`SELECT * WHERE id=${id}`);');
		expect(snippet).not.toContain('pad0 =');
		expect(snippet.length).toBeLessThanOrEqual(5000);
	});

	it('windows a hunk larger than the budget around the claimed line', () => {
		const lines = Array.from(
			{ length: 400 },
			(_, i) => `+line${i + 1} ${'y'.repeat(40)}`
		);
		const snippet = confirmationSnippet(hunk(1, lines), 300, 300, 2000);
		expect(snippet).toContain('+line300 ');
		expect(snippet).not.toContain('+line1 ');
		expect(snippet.length).toBeLessThanOrEqual(2000);
	});

	it('falls back to the head of the patch when no hunk covers the line', () => {
		const patch = hunk(1, ['+a', '+b']);
		expect(confirmationSnippet(patch, 90, 90, 5000)).toContain('+a');
	});

	it('returns an empty string for a missing patch', () => {
		expect(confirmationSnippet('', 1, 1, 5000)).toBe('');
	});
});

describe('confirmationSnippet edge cases', () => {
	it('copes with a header-only hunk that is over budget', () => {
		const patch = `@@ -1,0 +1,1 @@${' '.repeat(50)}`;
		expect(confirmationSnippet(patch, 1, 1, 10)).toBe(patch.slice(0, 10));
	});
});
