import { describe, expect, it } from 'vitest';
import { extractJsonBlock } from '../../src/llm/openai-compatible.js';

/**
 * Regression coverage for the Pi prose-then-JSON failure mode observed in
 * production: a harness answer that narrates first and then emits the review
 * artifact used to fail because the extractor only tried one slice
 * (`text.indexOf('{')` .. `text.lastIndexOf('}')`), which is not valid JSON
 * whenever anything else in the message contains braces.
 */
describe('extractJsonBlock with prose around the JSON artifact', () => {
	it('skips a prose object and returns the review artifact that follows', () => {
		const text = [
			'OK, ready to write findings. Let me focus on the actual issues:',
			'',
			'The config object {a: 1} is not valid JSON, so I will not do that.',
			'',
			'```json',
			'{"findings": [{"severity":"high","path":"src/a.ts","line":3}], "risk": "high"}',
			'```',
		].join('\n');
		const parsed = extractJsonBlock(text);
		expect(parsed).not.toBeNull();
		expect(parsed?.risk).toBe('high');
		expect(Array.isArray(parsed?.findings)).toBe(true);
	});

	it('prefers the candidate that matches the requested keys', () => {
		const text =
			'Scratch: {"note":"thinking"} then the artifact: {"findings":[],"summary":"clean","risk":"none"}';
		const parsed = extractJsonBlock(text, ['findings']);
		expect(parsed?.summary).toBe('clean');
	});

	it('returns the first parseable object when no key preference is given', () => {
		const text = '{"first":true} and {"second":true}';
		expect(extractJsonBlock(text)).toEqual({ first: true });
	});

	it('still parses a fenced JSON block', () => {
		expect(extractJsonBlock('```json\n{"a":[1,2]}\n```')).toEqual({
			a: [1, 2],
		});
	});

	it('returns null when no candidate parses', () => {
		expect(extractJsonBlock('nothing structured')).toBeNull();
		expect(extractJsonBlock('{ definitely not json }')).toBeNull();
	});

	it('ignores brace noise inside strings when scanning for candidates', () => {
		const text =
			'Warning: "}" is a closing brace. Final answer: {"findings":[],"summary":"ok"}';
		const parsed = extractJsonBlock(text, ['findings']);
		expect(parsed?.summary).toBe('ok');
	});
});
