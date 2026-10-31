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

	describe('invisible characters', () => {
		const token = ['gh', 'p_', 'Zq8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'].join('');
		const families: Record<string, string[]> = {
			'zero width': ['​', '‌', '‍', '⁠', '﻿'],
			'soft hyphen and joiner': ['­', '͏'],
			'mongolian selectors': ['᠋', '᠌', '᠍', '᠎'],
			'invisible operators': ['⁡', '⁢', '⁣', '⁤'],
			'bidi controls': ['‎', '‏', '‪', '‮', '⁦', '⁩'],
			'tag characters': ['\u{e0001}', '\u{e0020}', '\u{e007f}'],
			'variation selectors': ['︀', '️', '\u{e0100}', '\u{e01ef}'],
			'hangul fillers': ['ᅟ', 'ᅠ', 'ㅤ', 'ﾠ'],
		};
		const all = Object.entries(families).flatMap(([family, chars]) =>
			chars.map((ch) => [family, ch] as const)
		);

		it.each(all)('redacts a token split by %s (U+%#)', (_family, ch) => {
			const split = token.replace(/(.{5})/g, `$1${ch}`);
			expect(redactSecrets(`token: ${split} done`)).toBe(
				'token: [REDACTED_GITHUB_TOKEN] done'
			);
			expect(containsSecret(split)).toBe(true);
		});

		it('keeps text around an astral invisible character exact', () => {
			const split = `${token.slice(0, 8)}\u{e0100}${token.slice(8)}`;
			expect(redactSecrets(`a\u{e0020} ${split}\u{e0020} z`)).toBe(
				'a\u{e0020} [REDACTED_GITHUB_TOKEN]\u{e0020} z'
			);
		});

		it('redacts only the value of a password split by invisible characters', () => {
			const input = 'pass​word = "Hunter2‍Correct-Horse"';
			expect(redactSecrets(input)).toBe(
				'pass​word = "[REDACTED_PASSWORD_ASSIGNMENT]"'
			);
		});

		it('returns text without a match byte for byte, emoji sequences included', () => {
			const input = 'plain​ text \u{1f468}‍\u{1f469}‍\u{1f467} ❤️ with﻿ marks⁠';
			expect(redactSecrets(input)).toBe(input);
		});

		it('keeps invisible characters outside the match', () => {
			const input = `a​ ${token.slice(0, 8)}​${token.slice(8)} ​z`;
			expect(redactSecrets(input)).toBe('a​ [REDACTED_GITHUB_TOKEN] ​z');
		});

		it('does not strip ordinary spaces (known gap: they split a token)', () => {
			const split = token.replace(/(.{5})/g, '$1 ');
			expect(redactSecrets(split)).toBe(split);
		});
	});

	describe('assignment values', () => {
		it('redacts the value, not an identical key', () => {
			expect(redactSecrets('password="password"')).toBe(
				'password="[REDACTED_PASSWORD_ASSIGNMENT]"'
			);
			expect(redactSecrets('secret = "secret-secret"')).toBe(
				'secret = "[REDACTED_PASSWORD_ASSIGNMENT]"'
			);
		});

		it('keeps a trailing escaped backslash pair intact so JSON stays valid', () => {
			const line = JSON.stringify({ text: "password='abcdefgh\\'" });
			const redacted = redactSecrets(line);
			expect(redacted).not.toContain('abcdefgh');
			expect(JSON.parse(redacted).text).toBe(
				"password='[REDACTED_PASSWORD_ASSIGNMENT]'"
			);
		});

		it('keeps JSON-wrapped redacted lines valid across generated inputs', () => {
			let seed = 20260101;
			const next = (n: number): number => {
				seed = (seed * 1664525 + 1013904223) % 4294967296;
				return seed % n;
			};
			const pick = <T>(items: readonly T[]): T => items[next(items.length)];
			const alphabet = [...'abcXYZ019_-/+= ', '\\', '"', "'", '\\', 'é'];
			for (let i = 0; i < 4000; i++) {
				const value = Array.from({ length: 4 + next(14) }, () =>
					pick(alphabet)
				).join('');
				const quote = pick(['"', "'"]);
				const key = pick(['password', 'passwd', 'secret', 'PASSWORD']);
				const aws = `aws_secret_key=${quote}${'aB3/'.repeat(10)}${quote}`;
				const line = `${key}${pick([':', '=', ' = '])}${quote}${value}${quote} ${aws}`;
				const json = JSON.stringify({ i, text: line, tail: value });
				expect(() => JSON.parse(redactSecrets(json)), json).not.toThrow();
			}
		});
	});

	describe('JWTs and private keys', () => {
		const jwt = [
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
			'eyJzdWIiOiJldmFsLWNhbmFyeSIsIm5hbWUiOiJ0ZXN0In0.',
			'c2lnbmF0dXJlLWNhbmFyeS1ub3QtcmVhbA',
		].join('');
		const pem = [
			'-----BEGIN ',
			'PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END ',
			'PRIVATE KEY-----',
		].join('');

		it('redacts JWTs, including one after other base64url text and two in a row', () => {
			expect(redactSecrets(`jwt=${jwt} and "${jwt}"`)).toBe(
				'jwt=[REDACTED_JWT_TOKEN] and "[REDACTED_JWT_TOKEN]"'
			);
			expect(redactSecrets(`x${jwt}`)).toBe('x[REDACTED_JWT_TOKEN]');
			expect(redactSecrets(`${jwt}.${jwt}`)).not.toContain('eyJzdWIi');
		});

		it('leaves near-miss JWTs alone', () => {
			const input =
				'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0 and eyJshort.eyJshort.abc';
			expect(redactSecrets(input)).toBe(input);
		});

		it('redacts PEM blocks with surrounding text and invisible characters', () => {
			expect(redactSecrets(`a\n${pem}\nb ${pem}`)).toBe(
				'a\n[REDACTED_PRIVATE_KEY]\nb [REDACTED_PRIVATE_KEY]'
			);
			const split = pem.replace('KEY-----\nMII', 'KEY-----\nM​II');
			expect(redactSecrets(split)).toBe('[REDACTED_PRIVATE_KEY]');
		});

		it('leaves a BEGIN marker without an END marker alone', () => {
			const input = '-----BEGIN PRIVATE KEY-----\nabc';
			expect(redactSecrets(input)).toBe(input);
		});
	});

	describe('span merging', () => {
		const token = ['gh', 'p_', 'Zq8Lm2Xv4Rt7Yw1Bn5Cd9Fg3Hj6Kp0Sa8Ue'].join('');
		const awsKey = ['AK', 'IA', 'QZ7XM2LK9PT4WV8N'].join('');
		const jwt = [
			'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.',
			'eyJzdWIiOiJldmFsLWNhbmFyeSIsIm5hbWUiOiJ0ZXN0In0.',
			'c2lnbmF0dXJlLWNhbmFyeS1ub3QtcmVhbA',
		].join('');

		it('merges identical spans from two detectors into one label', () => {
			expect(redactSecrets(`password="${jwt}"`)).toBe(
				'password="[REDACTED_JWT_TOKEN]"'
			);
		});

		it('extends a merged span to the longer detector', () => {
			expect(redactSecrets(`secret="${token}-extra-tail-value"`)).toBe(
				'secret="[REDACTED_GITHUB_TOKEN]"'
			);
		});

		it('keeps the outer span when a shorter one sits inside it', () => {
			expect(redactSecrets(`secret="aaaaaaaa-${token}-tail-end"`)).toBe(
				'secret="[REDACTED_PASSWORD_ASSIGNMENT]"'
			);
		});

		it('keeps adjacent spans separate', () => {
			expect(redactSecrets(`${awsKey}${token}`)).toBe(
				'[REDACTED_AWS_ACCESS_KEY][REDACTED_GITHUB_TOKEN]'
			);
		});

		it.each([
			['at position 0', ''],
			['after text', 'note: '],
		])('keeps a leading invisible character %s', (_name, prefix) => {
			expect(redactSecrets(`${prefix}​${token}`)).toBe(
				`${prefix}​[REDACTED_GITHUB_TOKEN]`
			);
			expect(redactSecrets(`${prefix}\u{e0100}​${token}​`)).toBe(
				`${prefix}\u{e0100}​[REDACTED_GITHUB_TOKEN]​`
			);
		});
	});

	describe('long and neighbouring values', () => {
		it('redacts an armoured key far larger than 64 KiB', () => {
			const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n'.repeat(6000);
			expect(body.length).toBeGreaterThan(190_000);
			const pem = `-----BEGIN PRIVATE KEY-----\n${body}-----END PRIVATE KEY-----`;
			expect(redactSecrets(`before\n${pem}\nafter`)).toBe(
				'before\n[REDACTED_PRIVATE_KEY]\nafter'
			);
		});

		it('keeps neighbouring fields of space-free escaped JSON', () => {
			const input = 'password=\\"hunter2hunter2\\",\\"user\\":\\"bob\\"';
			const redacted = redactSecrets(input);
			expect(redacted).toBe(
				'password=\\"[REDACTED_PASSWORD_ASSIGNMENT]\\",\\"user\\":\\"bob\\"'
			);
			const wrapped = JSON.stringify({
				a: 'password="hunter2hunter2"',
				user: 'bob',
			});
			expect(JSON.parse(redactSecrets(wrapped)).user).toBe('bob');
			expect(redactSecrets(wrapped)).not.toContain('hunter2');
		});

		it('still redacts an escaped value that contains an escaped quote', () => {
			const wrapped = JSON.stringify({ t: 'password="ab"cdefghijk"' });
			const redacted = redactSecrets(wrapped);
			expect(redacted).not.toContain('cdefghijk');
			expect(() => JSON.parse(redacted)).not.toThrow();
		});
	});

	describe('performance', () => {
		/** Worst-case ratio between a 4x larger input and the base one. */
		function growth(make: (size: number) => string, size: number): number {
			const time = (n: number): number => {
				const input = make(n);
				let best = Number.POSITIVE_INFINITY;
				for (let run = 0; run < 3; run++) {
					const started = performance.now();
					redactSecrets(input);
					best = Math.min(best, performance.now() - started);
				}
				return best;
			};
			time(size / 4);
			// A 5 ms floor keeps timer noise from inflating the ratio.
			return time(size * 4) / Math.max(time(size), 5);
		}

		const adversarial: Record<string, [(n: number) => string, number]> = {
			'repeated eyJ': [(n) => 'eyJ'.repeat(n / 3), 20_000],
			'JWT-like segments': [
				(n) => 'eyJaaaaaaaaaaaa.eyJaaaaaaaaaaaa.'.repeat(n / 33),
				20_000,
			],
			'BEGIN markers with mismatched ENDs': [
				(n) => '-----BEGIN PRIVATE KEY-----\n-----END X-----'.repeat(n / 43),
				60_000,
			],
			'repeated BEGIN markers': [
				(n) => '-----BEGIN PRIVATE KEY-----'.repeat(n / 27),
				60_000,
			],
			'BEGIN markers, one far END': [
				(n) =>
					`${'-----BEGIN PRIVATE KEY-----'.repeat(n / 27)}-----END PRIVATE KEY-----`,
				60_000,
			],
			'unterminated password': [(n) => `password = "${'a'.repeat(n)}`, 60_000],
			'backslash run': [(n) => `password = \\"${'\\'.repeat(n)}`, 60_000],
			'repeated password keyword': [(n) => 'password="'.repeat(n / 10), 60_000],
			'bearer and spaces': [(n) => `Bearer${' '.repeat(n)}`, 60_000],
			'repeated bearer': [(n) => 'Bearer '.repeat(n / 7), 60_000],
			'invisible run': [(n) => '​'.repeat(n), 60_000],
			'invisible-split eyJ': [(n) => 'eyJ​'.repeat(n / 4), 20_000],
		};

		it.each(Object.entries(adversarial))(
			'scales linearly on %s',
			(_name, [make, size]) => {
				expect(growth(make, size)).toBeLessThan(12);
			}
		);
	});
});
