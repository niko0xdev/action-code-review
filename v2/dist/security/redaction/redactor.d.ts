/**
 * Secret redaction utility for security logs, summaries, SARIF, and comments.
 * Spec reference: §21.
 */
/**
 * Redact sensitive secrets from raw text.
 */
export declare function redactSecrets(text: string): string;
/**
 * Check if a string contains known secret patterns.
 */
export declare function containsSecret(text: string): boolean;
//# sourceMappingURL=redactor.d.ts.map