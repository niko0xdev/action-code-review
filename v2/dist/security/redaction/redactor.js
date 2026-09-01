/**
 * Secret redaction utility for security logs, summaries, SARIF, and comments.
 * Spec reference: §21.
 */
const SECRET_PATTERNS = [
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
        pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
    },
    // AWS Secret Access Key (heuristic assignment)
    {
        name: 'aws_secret_key',
        pattern: /(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*["']?([a-zA-Z0-9/+=]{40})["']?/gi,
    },
    // Private Keys (RSA, EC, OpenSSH, PGP)
    {
        name: 'private_key',
        pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    },
    // Slack Tokens
    {
        name: 'slack_token',
        pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g,
    },
    // JWT Tokens
    {
        name: 'jwt_token',
        pattern: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
    },
    // Generic API keys and Bearer tokens
    {
        name: 'bearer_token',
        pattern: /Bearer\s+([a-zA-Z0-9\-._~+/]+=*)/gi,
    },
    // Generic passwords in URLs or assignments
    {
        name: 'password_assignment',
        pattern: /(?:password|passwd|secret)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    },
];
/**
 * Redact sensitive secrets from raw text.
 */
export function redactSecrets(text) {
    if (!text)
        return text;
    let redacted = text;
    for (const { name, pattern } of SECRET_PATTERNS) {
        redacted = redacted.replace(pattern, (match, captured) => {
            if (captured && typeof captured === 'string') {
                return match.replace(captured, `[REDACTED_${name.toUpperCase()}]`);
            }
            return `[REDACTED_${name.toUpperCase()}]`;
        });
    }
    return redacted;
}
/**
 * Check if a string contains known secret patterns.
 */
export function containsSecret(text) {
    if (!text)
        return false;
    return SECRET_PATTERNS.some(({ pattern }) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
    });
}
//# sourceMappingURL=redactor.js.map