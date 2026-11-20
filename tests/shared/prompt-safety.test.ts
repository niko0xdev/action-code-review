import { describe, expect, it } from 'vitest';
import {
	escapeControlChars,
	escapeHidden,
	fenceFor,
	fenced,
	redactForPrompt,
} from '../../src/shared/prompt-safety.js';

describe('escapeControlChars', () => {
	it('writes line breaks and control characters as visible escapes', () => {
		expect(escapeControlChars('a\nb\rc\u2028d\u2029e\u0000f\u007fg')).toBe(
			'a\\nb\\rc\\u2028d\\u2029e\\u0000f\\u007fg'
		);
	});

	it('escapes bidirectional controls and zero-width characters', () => {
		const hidden = [
			'\u202a',
			'\u202b',
			'\u202c',
			'\u202d',
			'\u202e',
			'\u2066',
			'\u2067',
			'\u2068',
			'\u2069',
			'\u200b',
			'\u200c',
			'\u200d',
			'\u2060',
			'\ufeff',
		];
		for (const ch of hidden) {
			const out = escapeControlChars(`x${ch}y`);
			expect(out).toBe(
				`x\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}y`
			);
		}
		expect(escapeControlChars('a\u202eb')).toBe('a\\u202eb');
	});

	it('escapes the left-to-right and right-to-left marks', () => {
		expect(escapeControlChars('a\u200eb')).toBe('a\\u200eb');
		expect(escapeControlChars('a\u200fb')).toBe('a\\u200fb');
		expect(escapeControlChars('a\u061cb')).toBe('a\\u061cb');
	});

	it('writes a Unicode tag character as a JSON-compatible escape', () => {
		const escaped = escapeHidden('a\u{E0020}b');
		expect(escaped).toBe('a\\ud800\\udc20b');
		expect(() => JSON.parse(`"${escaped}"`)).not.toThrow();
	});

	it('leaves ordinary text, including non-Latin scripts and emoji, alone', () => {
		const text = 'src/ünï/文件 😀.ts';
		expect(escapeControlChars(text)).toBe(text);
	});
});

describe('fenceFor and fenced', () => {
	it('is three backticks without any inner run', () => {
		expect(fenceFor('plain')).toBe('```');
	});

	it('is longer than the longest inner backtick run', () => {
		for (const n of [3, 4, 10]) {
			expect(fenceFor(`a ${'`'.repeat(n)} b`)).toHaveLength(n + 1);
		}
	});

	it('wraps content so no inner line closes the fence', () => {
		const text = ['`'.repeat(3), '`'.repeat(10), 'x'].join('\n');
		const out = fenced(text, 'diff').split('\n');
		expect(out[0]).toBe(`${'`'.repeat(11)}diff`);
		expect(out.at(-1)).toBe('`'.repeat(11));
		expect(out.slice(1, -1).join('\n')).toBe(text);
	});
});

describe('redactForPrompt', () => {
	it('keeps identifiers that merely contain a token prefix', () => {
		const text =
			"import { run } from './disk-cache-manager-service-impl';\nconst task-runner = 'risk-assessment-pipeline-v2';";
		expect(redactForPrompt(text)).toBe(text);
	});

	it('never merges a Bearer line with the next diff line', () => {
		const patch =
			'+const header = "Bearer"\n+const next = compute();\n context';
		const out = redactForPrompt(patch);
		expect(out.split('\n')).toHaveLength(3);
		expect(out).toContain('+const next = compute();');
	});

	it('covers private keys, AWS secrets, and the short token forms', () => {
		const out = redactForPrompt(
			[
				'+-----BEGIN RSA PRIVATE KEY-----',
				'+MIIEowIBAAKCAQEAPRIVATEKEYBODY',
				'+-----END RSA PRIVATE KEY-----',
				'+aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"',
				'+sk-short gho_body Bearer abc.def',
			].join('\n')
		);
		expect(out).not.toMatch(
			/PRIVATEKEYBODY|wJalrXUtnFEMI|sk-short|gho_body|abc\.def/
		);
	});
});
