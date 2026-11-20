/**
 * Helpers that keep untrusted text (file names, finding fields, diffs, code
 * excerpts) contained when it is placed in a model prompt.
 */

import { scrubSecrets } from '../llm/openai-compatible.js';
import { redactSecrets } from '../security/redaction/redactor.js';

/** Characters a reviewer cannot see or that can break a line (CR and LF aside). */
function isHidden(code: number): boolean {
	return (
		(code < 0x20 && code !== 0x0a && code !== 0x0d) ||
		(code >= 0x7f && code <= 0x9f) ||
		code === 0x2028 ||
		code === 0x2029 ||
		(code >= 0x202a && code <= 0x202e) ||
		(code >= 0x2066 && code <= 0x2069) ||
		(code >= 0x200b && code <= 0x200d) ||
		code === 0x2060 ||
		code === 0xfeff
	);
}

/**
 * Write every hidden character as `\uXXXX` (`\u{XXXXX}` for Unicode tag
 * characters, U+E0000 to U+E007F, which are invisible to people but read by
 * models); other text is untouched.
 */
export function escapeHidden(text: string): string {
	return Array.from(text, (ch) => {
		const code = ch.codePointAt(0) ?? 0;
		if (code >= 0xe0000 && code <= 0xe007f) return `\\u{${code.toString(16)}}`;
		return isHidden(code) ? `\\u${code.toString(16).padStart(4, '0')}` : ch;
	}).join('');
}

/**
 * Make untrusted text safe to place on a single prompt line. Line breaks,
 * other control characters (a git path may contain them), bidirectional
 * controls, and zero-width characters are written as visible escapes, so
 * attacker text can neither start a new line outside a fenced block nor hide
 * behind characters the reviewer cannot see. Not for diff bodies, which must
 * stay byte-faithful.
 */
export function escapeControlChars(text: string): string {
	return escapeHidden(text.replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
}

/**
 * Pretty JSON for a prompt with hidden characters written as `\uXXXX`, which
 * JSON reads as the same character, so the layout is untouched.
 */
export function jsonForPrompt(value: unknown): string {
	return escapeHidden(JSON.stringify(value, null, 2));
}

/** A fence longer than any backtick run in `text`, so no line can close it. */
export function fenceFor(text: string): string {
	const longest = Math.max(
		0,
		...(text.match(/`+/g) ?? []).map((run) => run.length)
	);
	return '`'.repeat(Math.max(3, longest + 1));
}

/** Wrap `text` in a code fence that its own content cannot close. */
export function fenced(text: string, lang = ''): string {
	const fence = fenceFor(text);
	return `${fence}${lang}\n${text}\n${fence}`;
}

/**
 * Redaction for untrusted text placed in a model prompt: the precise detectors
 * of `redactSecrets` (private keys, AWS secrets, passwords) followed by the
 * broader token scrubber. Both keep line structure, so diff line numbers hold.
 */
export function redactForPrompt(text: string): string {
	return scrubSecrets(redactSecrets(text));
}
