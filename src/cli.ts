import * as core from '@actions/core';
import * as github from '@actions/github';
import { isActorAllowed } from './github/actor-filter.js';
import { resolveReviewMode, validateReviewEvent } from './modes/detector.js';
import { runPrContentAction } from './runners/pr-content.js';
import { runPrReviewAction } from './runners/review.js';
import { runSecurityAction } from './runners/security.js';

export { escalateMaxTokens } from './runners/pr-content.js';
export {
	applyLegacyFilters,
	classifyEmptySelection,
	normalizeIncludeDir,
	readReviewEnvLimits,
} from './runners/review.js';

export function parseArgs(args: string[]): { action: string } {
	return {
		action:
			(args[0] ?? 'pr-review') === 'pr-content' ? 'pr-content' : 'pr-review',
	};
}

export async function main(argv: string[]): Promise<void> {
	try {
		const mode = resolveReviewMode(core.getInput('mode') || undefined);
		const eventName = process.env.GITHUB_EVENT_NAME;
		const eventAction = (github.context.payload as { action?: string }).action;
		const validation = validateReviewEvent(eventName, eventAction);
		if (!validation.supported) {
			core.warning(
				`[review] Unsupported event ${eventName ?? 'unknown'}${eventAction ? `/${eventAction}` : ''}: ${validation.reason} — skipping review.`
			);
			return;
		}
		const options = parseArgs(argv);
		core.info(
			`[review] initialized (action: ${options.action}, mode: ${mode})`
		);
		const actorForFilter =
			process.env.GITHUB_ACTOR ??
			(
				github.context.payload.pull_request?.user as
					| { login?: string }
					| undefined
			)?.login ??
			(github.context.actor as string | undefined) ??
			'';
		const actorCheck = isActorAllowed(actorForFilter, {
			allowedBots: core.getInput('allowed-bots'),
			excludeActors: core.getInput('exclude-actors'),
		});
		if (!actorCheck.allowed) {
			core.info(`[review] Skipping review: ${actorCheck.reason}`);
			return;
		}
		if (options.action === 'pr-content') {
			await runPrContentAction();
			return;
		}

		if (mode === 'security') {
			await runSecurityAction();
			return;
		}

		await runPrReviewAction();
	} catch (error) {
		core.setFailed(
			`Action failed: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}
