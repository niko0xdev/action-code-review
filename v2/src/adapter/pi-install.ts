/**
 * Pi runtime provisioning (spec §22/§29 follow-up).
 *
 * The composite action installs the Pi coding agent itself, so consumer
 * repositories never see it: no workflow changes, no extra setup steps.
 * The version is pinned for reproducible installs; the guard skips work
 * when the binary already resolves on PATH (warm caches).
 */

export const PI_PACKAGE = '@mariozechner/pi-coding-agent';
/** Pinned upstream release; bump deliberately and document in docs/v2-architecture.md. */
export const PI_PACKAGE_PIN = '0.73.1';

/**
 * Bash script body for the composite install step. Idempotent: a pre-
 * existing `pi` binary short-circuits the npm install.
 */
export function buildInstallStepScript(): string {
	return [
		'if ! command -v pi >/dev/null 2>&1; then',
		`  npm install -g ${PI_PACKAGE}@${PI_PACKAGE_PIN} --no-audit --no-fund --silent`,
		'fi',
	].join('\n');
}
