import * as core from '@actions/core';

/**
 * V2 engine entry point.
 *
 * The legacy `pr-content` and `pr-review` actions delegate here through
 * thin compatibility adapters. The public interface (inputs, outputs,
 * environment variables) is frozen by docs/v1-interface-contract.md —
 * this CLI must accept exactly those inputs.
 */

export interface CliOptions {
	action: 'pr-review' | 'pr-content';
}

export function parseArgs(args: string[]): CliOptions {
	const action = args[0] === 'pr-content' ? 'pr-content' : 'pr-review';
	return { action };
}

export async function main(argv: string[]): Promise<void> {
	const options = parseArgs(argv);
	core.info(`[review] V2 initialized (action: ${options.action})`);
	// Engine wiring lands feature-by-feature; adapters keep working against
	// the frozen V1 interface in the meantime.
}
