import { describe, expect, it } from 'vitest';
import {
	containsSecret,
	redactSecrets,
} from '../../src/security/redaction/redactor.js';

describe('SecretRedaction', () => {
	it('redacts GitHub personal access tokens', () => {
		const input =
			'Error with token ghp_1234567890abcdef1234567890abcdef in request';
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain('ghp_1234567890abcdef');
		expect(redacted).toContain('[REDACTED_GITHUB_TOKEN]');
		expect(containsSecret(input)).toBe(true);
	});

	it('redacts OpenAI API keys', () => {
		const input = 'const apiKey = "sk-proj-1234567890abcdef1234567890abcdef";';
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain('sk-proj-1234567890abcdef');
		expect(redacted).toContain('[REDACTED_OPENAI_KEY]');
		expect(containsSecret(input)).toBe(true);
	});

	it('redacts AWS Access Key IDs', () => {
		const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain('AKIAIOSFODNN7EXAMPLE');
		expect(redacted).toContain('[REDACTED_AWS_ACCESS_KEY]');
		expect(containsSecret(input)).toBe(true);
	});

	it('redacts Private Keys', () => {
		const input = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Yq3...fake...private...key...data
-----END RSA PRIVATE KEY-----
`;
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain('BEGIN RSA PRIVATE KEY');
		expect(redacted).toContain('[REDACTED_PRIVATE_KEY]');
		expect(containsSecret(input)).toBe(true);
	});

	it('redacts Bearer tokens in headers', () => {
		const input = 'Authorization: Bearer mySecretToken1234567890';
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain('mySecretToken1234567890');
		expect(redacted).toContain('[REDACTED_BEARER_TOKEN]');
	});

	it('redacts hardcoded password assignments', () => {
		const input = 'const password = "super_secret_db_password_123!";';
		const redacted = redactSecrets(input);
		expect(redacted).not.toContain('super_secret_db_password_123!');
		expect(redacted).toContain('[REDACTED_PASSWORD_ASSIGNMENT]');
	});

	it('leaves benign non-sensitive text untouched', () => {
		const input =
			'function calculateSum(a: number, b: number): number { return a + b; }';
		expect(redactSecrets(input)).toBe(input);
		expect(containsSecret(input)).toBe(false);
	});

	describe('JSON-escaped quotes', () => {
		const password = ['Hunter2', 'Correct-Horse'].join('');
		const awsSecret = ['aB3/', 'xY9+'.repeat(9), 'Zq7='].join('').slice(0, 40);

		it('redacts a password assignment inside a JSON string and keeps it valid JSON', () => {
			const line = JSON.stringify({ text: `password = "${password}" end` });
			expect(line).toContain('\\"');
			const redacted = redactSecrets(line);
			expect(redacted).not.toContain(password);
			expect(redacted).toContain('[REDACTED_PASSWORD_ASSIGNMENT]');
			expect(JSON.parse(redacted).text).toBe(
				'password = "[REDACTED_PASSWORD_ASSIGNMENT]" end'
			);
		});

		it('redacts an AWS secret assignment inside a JSON string', () => {
			const line = JSON.stringify({
				text: `aws_secret_access_key = "${awsSecret}"`,
			});
			const redacted = redactSecrets(line);
			expect(redacted).not.toContain(awsSecret);
			expect(redacted).toContain('[REDACTED_AWS_SECRET_KEY]');
			expect(() => JSON.parse(redacted)).not.toThrow();
		});

		it('still redacts the raw quoted forms', () => {
			expect(redactSecrets(`secret: '${password}'`)).toBe(
				"secret: '[REDACTED_PASSWORD_ASSIGNMENT]'"
			);
			expect(redactSecrets(`aws_secret_key="${awsSecret}"`)).toContain(
				'[REDACTED_AWS_SECRET_KEY]'
			);
		});
	});

	describe('zero-width characters', () => {
		const token = ['gh', 'p_', 'Zq8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'].join('');
		const zeroWidth = ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff'];

		it.each(zeroWidth)(
			'redacts a token split by zero-width character %#',
			(ch) => {
				const split = token.replace(/(.{5})/g, `$1${ch}`);
				const redacted = redactSecrets(`token: ${split} done`);
				expect(redacted).toBe('token: [REDACTED_GITHUB_TOKEN] done');
				expect(containsSecret(split)).toBe(true);
			}
		);

		it('redacts a password assignment split by zero-width characters', () => {
			const input = 'pass\u200bword = "Hunter2\u200dCorrect-Horse"';
			expect(redactSecrets(input)).toBe(
				'password = "[REDACTED_PASSWORD_ASSIGNMENT]"'
			);
		});

		it('leaves text without a match byte-for-byte unchanged', () => {
			const input = 'plain\u200b text with\ufeff invisible\u2060 marks';
			expect(redactSecrets(input)).toBe(input);
		});

		it('keeps surrounding text, including invisible characters outside the match', () => {
			const input = `a\u200b ${token.slice(0, 8)}\u200b${token.slice(8)} \u200bz`;
			expect(redactSecrets(input)).toBe(
				'a\u200b [REDACTED_GITHUB_TOKEN] \u200bz'
			);
		});

		it('stays linear on long adversarial input', () => {
			const inputs = [
				'\u200b'.repeat(300_000),
				`${token.slice(0, 4)}${'\u200b'.repeat(300_000)}`,
				`password = "${'a\u200b'.repeat(150_000)}`,
				`password = \\"${'\\'.repeat(200_000)}`,
				`Bearer ${'a\u200b'.repeat(150_000)}`,
			];
			const started = performance.now();
			for (const input of inputs) redactSecrets(input);
			expect(performance.now() - started).toBeLessThan(1000);
		});
	});
});
