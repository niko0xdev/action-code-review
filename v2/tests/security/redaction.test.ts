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
});
