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
	'NODE_EXTRA_CA_CERTS',
	'REQUESTS_CA_BUNDLE',
	'JAVA_HOME',
	'XDG_CONFIG_HOME',
	'XDG_CACHE_HOME',
	'XDG_DATA_HOME',
	'HTTP_PROXY',
	'HTTPS_PROXY',
	'NO_PROXY',
	'http_proxy',
	'https_proxy',
	'no_proxy',
	'GOPATH',
	'RUSTUP_HOME',
	'CARGO_HOME',
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

/** Kills the analyser's process group (falls back to the child alone). */
export function killAnalyser(
	child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean },
	signal: NodeJS.Signals = 'SIGKILL'
): void {
	if (process.platform !== 'win32' && child.pid) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch {
			// The group is already gone; fall through to the direct child.
		}
	}
	try {
		child.kill(signal);
	} catch {
		// Already exited.
	}
}
