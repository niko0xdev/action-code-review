/**
 * Shared hardening for child processes that analyse untrusted PR content
 * (linters, Semgrep). Keeps API keys and tokens out of the child environment,
 * stops PR file names being parsed as flags, and bounds collected output.
 */

/** Environment variables an analyser may inherit; everything else is dropped. */
const ENV_ALLOWLIST = [
	'PATH',
	'HOME',
	'USER',
	'LANG',
	'LC_ALL',
	'LC_CTYPE',
	'TMPDIR',
	'TEMP',
	'TMP',
	'SystemRoot',
	'SSL_CERT_FILE',
	'SSL_CERT_DIR',
] as const;

/** Ceiling on collected stdout or stderr from one analyser process. */
export const MAX_ANALYSER_OUTPUT_BYTES = 16 * 1024 * 1024;

export function buildAnalyserEnv(
	extra: Record<string, string> = {}
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {};
	for (const key of ENV_ALLOWLIST) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	return { ...env, ...extra };
}

/** Drops PR file names that an analyser CLI could mistake for an option. */
export function safeTargetFiles(files: string[]): string[] {
	return files.filter((file) => !file.startsWith('-'));
}
