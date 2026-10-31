/**
 * Secret redaction utility for security logs, summaries, SARIF, and comments.
 * Spec reference: §21.
 */

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
	// GitHub Tokens (PAT, OAuth, fine-grained, app)
	{
		name: 'github_token',
		pattern: /(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{16,255}/g,
	},
	// OpenAI API Key
	{
		name: 'openai_key',
		pattern: /sk-(?:proj-|svcacct-|admin-)?[a-zA-Z0-9_-]{20,80}/g,
	},
	// AWS Access Key ID
	{
		name: 'aws_access_key',
		pattern:
			/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
	},
	// AWS Secret Access Key (heuristic assignment)
	{
		name: 'aws_secret_key',
		pattern:
			/(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*(?:\\?["'])?([a-zA-Z0-9/+=]{40})(?:\\?["'])?/gi,
	},
	// Private Keys (RSA, EC, OpenSSH, PGP)
	{
		name: 'private_key',
		pattern:
			/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
	},
	// Slack Tokens
	{
		name: 'slack_token',
		pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
	},
	// JWT Tokens
	{
		name: 'jwt_token',
		pattern:
			/eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
	},
	// Generic API keys and Bearer tokens
	{
		name: 'bearer_token',
		pattern: /Bearer\s+([a-zA-Z0-9\-._~+/]+=*)/gi,
	},
	// Generic passwords in URLs or assignments
	{
		name: 'password_assignment',
		// The quote may be JSON-escaped (`\"`); a backslash that starts that
		// escape is not part of the value, so the escape survives redaction.
		pattern:
			/(?:password|passwd|secret)\s*[:=]\s*\\?["']((?:[^"'\s\\]|\\(?!["'])){8,})\\?["']/gi,
	},
];

/** Characters that render as nothing and so can hide a token from a pattern. */
const ZERO_WIDTH = /\u200b|\u200c|\u200d|\u2060|\ufeff/;
const ZERO_WIDTH_ALL = new RegExp(ZERO_WIDTH.source, 'g');
const ZERO_WIDTH_CHARS = new Set([
	'\u200b',
	'\u200c',
	'\u200d',
	'\u2060',
	'\ufeff',
]);

function replacement(name: string, match: string, captured: unknown): string {
	const label = `[REDACTED_${name.toUpperCase()}]`;
	return typeof captured === 'string' && captured
		? match.replace(captured, label)
		: label;
}

/**
 * Match against a copy of the text without zero-width characters, then replace
 * the matching span of the original. Text that does not match is unchanged;
 * invisible characters inside a redacted span are removed with it.
 */
function redactPattern(text: string, name: string, pattern: RegExp): string {
	if (!ZERO_WIDTH.test(text))
		return text.replace(pattern, (match, captured) =>
			replacement(name, match, captured)
		);
	const kept: string[] = [];
	const offsets: number[] = [];
	for (let i = 0; i < text.length; i++) {
		if (ZERO_WIDTH_CHARS.has(text[i])) continue;
		kept.push(text[i]);
		offsets.push(i);
	}
	let out = '';
	let cursor = 0;
	// matchAll starts at lastIndex, which containsSecret leaves non-zero.
	pattern.lastIndex = 0;
	for (const m of kept.join('').matchAll(pattern)) {
		const first = m.index ?? 0;
		out += text.slice(cursor, offsets[first]);
		out += replacement(name, m[0], m[1]);
		cursor = offsets[first + m[0].length - 1] + 1;
	}
	return out + text.slice(cursor);
}

/**
 * Redact sensitive secrets from raw text.
 */
export function redactSecrets(text: string): string {
	if (!text) return text;
	let redacted = text;
	for (const { name, pattern } of SECRET_PATTERNS)
		redacted = redactPattern(redacted, name, pattern);
	return redacted;
}

/**
 * Check if a string contains known secret patterns.
 */
export function containsSecret(text: string): boolean {
	if (!text) return false;
	const visible = text.replace(ZERO_WIDTH_ALL, '');
	return SECRET_PATTERNS.some(({ pattern }) => {
		pattern.lastIndex = 0;
		return pattern.test(visible);
	});
}
