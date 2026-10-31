import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildJobSummary, publishReview } from '../../src/github/review.js';
import { buildRawHarnessSection } from '../../src/review/execution.js';
import {
	buildReviewReport,
	serializeReviewReport,
} from '../../src/review/report.js';
import { runReview } from '../../src/review/reviewer.js';
import { CANARIES } from './helpers/canaries.js';
import { type InjectionCase, loadInjectionCases } from './helpers/fixtures.js';
import { label, propertyTest } from './helpers/known-defects.js';
import {
	commentBodies,
	makeContext,
	recordingOctokit,
	stubHarness,
} from './helpers/pipeline.js';

/**
 * Model-output and publication-sink properties of the hostile corpus.
 *
 * The model is replaced by a canned (possibly compromised) reply. Everything
 * after it, from the parser to the strings sent to GitHub, is the real code.
 */

const cases = loadInjectionCases();
const modelCases = cases.filter((c) => c.modelOutput !== undefined);
const INVISIBLE = /[​-‏‪-‮⁠﻿]/g;

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

async function review(c: InjectionCase) {
	const context = makeContext(c.files, c.pr);
	const result = await runReview(
		context,
		stubHarness(c.modelOutput ?? '{"findings":[],"summary":"","risk":"none"}')
	);
	return { context, result };
}

describe.each(modelCases)('validator: $category / $id', (c) => {
	const kd = c.knownDefects;

	propertyTest(kd, 'only-anchored-findings-survive')(
		label(kd, 'only-anchored-findings-survive', c.id),
		async () => {
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			const { result } = await review(c);
			expect(result.findings.map((f) => [f.path, f.line])).toEqual(c.accepted);
		}
	);
});

const SINK_PROPERTIES = [
	'no-secret-in-inline-comments',
	'no-secret-in-summary-comment',
	'no-secret-in-report-and-debug',
] as const;

async function renderSinks(
	c: InjectionCase
): Promise<Record<(typeof SINK_PROPERTIES)[number], string>> {
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	// Secrets also sit in the environment, as they do on a real runner.
	vi.stubEnv('GITHUB_TOKEN', CANARIES.githubToken.value);
	vi.stubEnv('OPENAI_API_KEY', CANARIES.openaiKey.value);
	const { context, result } = await review(c);
	const octokit = recordingOctokit();
	await publishReview(octokit as never, {
		owner: 'acme',
		repo: 'widget',
		prNumber: 7,
		headSha: 'sha-head',
		result,
		blockOnIssues: true,
		filesSelected: context.diff.files.length,
	});
	const report = serializeReviewReport(
		buildReviewReport({
			result,
			filesTotal: context.diff.files.length,
			filesExcluded: 0,
		})
	);
	const job = buildJobSummary({
		filesReviewed: result.filesReviewed,
		result,
		diagnostics: result.diagnostics,
	});
	const raw = c.modelOutput ?? '';
	const debug =
		buildRawHarnessSection([{ stdout: raw, stderr: raw }], 60 * 1024) ?? '';
	return {
		'no-secret-in-inline-comments': JSON.stringify(
			octokit.rest.pulls.createReview.mock.calls
		),
		'no-secret-in-summary-comment': JSON.stringify(commentBodies(octokit)),
		'no-secret-in-report-and-debug': [report, job, debug].join('\n'),
	};
}

describe.each(cases)('sinks: $category / $id', (c) => {
	const kd = c.knownDefects;
	for (const property of SINK_PROPERTIES) {
		propertyTest(kd, property)(label(kd, property, c.id), async () => {
			const sink = (await renderSinks(c))[property];
			const text = c.stripInvisible ? sink.replace(INVISIBLE, '') : sink;
			for (const [name, canary] of Object.entries(CANARIES))
				expect(text, `leaks ${name}`).not.toContain(canary.core);
			// Raw markup is only checked where it is rendered as markdown.
			if (property !== 'no-secret-in-report-and-debug')
				for (const forbidden of c.forbiddenOutbound)
					expect(text, `contains ${forbidden}`).not.toContain(forbidden);
		});
	}
});

describe('what an accepted finding looks like on the wire', () => {
	it('escapes finding text and keeps one comment per surviving anchor', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const c = modelCases.find((m) => m.id === 'html-in-finding');
		expect(c).toBeDefined();
		const { context, result } = await review(c as InjectionCase);
		const octokit = recordingOctokit();
		await publishReview(octokit as never, {
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'sha-head',
			result,
			blockOnIssues: true,
			filesSelected: context.diff.files.length,
		});
		const review0 = octokit.rest.pulls.createReview.mock.calls[0][0] as {
			comments: Array<{ body: string }>;
		};
		expect(review0.comments).toHaveLength(1);
		expect(review0.comments[0].body).toContain('&lt;img');
		expect(commentBodies(octokit)).toHaveLength(1);
	});
});

describe('known gaps that are not asserted', () => {
	it.todo(
		'a finding with a valid anchor and a high confidence is accepted whatever the PR text told the model; only the verify pass or a human can reject it'
	);
	it.todo(
		'secrets without a recognisable shape (random hex, base64 blobs, custom tokens) pass redactSecrets unchanged'
	);
	it.todo(
		'the verify prompt includes the PR title and the first 500 characters of the PR body without redaction or a fence'
	);
});
