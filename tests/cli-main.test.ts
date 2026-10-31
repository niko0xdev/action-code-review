import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Characterisation tests for `main()`: they pin the observable behaviour
// (warnings, outputs, failures, side-effect calls) of each top-level flow so
// the orchestration can be split into runners without changing it.

const state = vi.hoisted(() => ({
	payload: {} as Record<string, unknown>,
	pr: {} as Record<string, unknown>,
	reviewResult: {} as Record<string, unknown>,
	securityResult: {} as Record<string, unknown>,
	cleanup: vi.fn(async () => {}),
	publishReview: vi.fn(async () => {}),
	runReview: vi.fn(),
	runSecurityWorkflow: vi.fn(),
	publishSecurityReview: vi.fn(async () => {}),
	updatePrContent: vi.fn(async () => {}),
	complete: vi.fn(),
	applyVerify: undefined as undefined | ((...args: unknown[]) => Promise<void>),
}));

vi.mock('@actions/github', () => ({
	context: {
		get payload() {
			return state.payload;
		},
		repo: { owner: 'acme', repo: 'widget' },
		sha: 'ctx-sha',
		actor: 'dev',
	},
	getOctokit: vi.fn(() => ({
		rest: {
			repos: {
				getContent: vi.fn(async () => {
					throw new Error('no template');
				}),
			},
		},
	})),
}));

vi.mock('../src/context/pr.js', () => ({
	fetchPrContext: vi.fn(async () => state.pr),
}));

vi.mock('../src/adapter/runtime.js', () => ({
	preparePiRuntimeConfig: vi.fn(async () => ({
		configDir: '/tmp/pi-config',
		cleanup: state.cleanup,
	})),
}));

vi.mock('../src/harness/pi.js', async (importOriginal) => {
	const original =
		await importOriginal<typeof import('../src/harness/pi.js')>();
	class FakeHarness {
		runs = [];
	}
	return { ...original, PiHarness: FakeHarness };
});

vi.mock('../src/review/reviewer.js', () => ({ runReview: state.runReview }));

vi.mock('../src/github/review.js', async (importOriginal) => {
	const original =
		await importOriginal<typeof import('../src/github/review.js')>();
	return { ...original, publishReview: state.publishReview };
});

vi.mock('../src/security/orchestrator.js', () => ({
	runSecurityWorkflow: state.runSecurityWorkflow,
}));

vi.mock('../src/security/reporters/security-publisher.js', () => ({
	publishSecurityReview: state.publishSecurityReview,
}));

vi.mock('../src/github/pr-content.js', () => ({
	updatePrContent: state.updatePrContent,
}));

vi.mock('../src/review/verify.js', async (importOriginal) => {
	const original =
		await importOriginal<typeof import('../src/review/verify.js')>();
	return {
		...original,
		applyVerifyPass: (...args: Parameters<typeof original.applyVerifyPass>) =>
			state.applyVerify
				? state.applyVerify(...args)
				: original.applyVerifyPass(...args),
	};
});

vi.mock('../src/llm/openai-compatible.js', () => ({
	OpenAiCompatibleProvider: class {
		complete = state.complete;
	},
}));

import { main } from '../src/cli.js';

const ENV_KEYS = [
	'GITHUB_EVENT_NAME',
	'GITHUB_ACTOR',
	'GITHUB_WORKSPACE',
	'AI_REVIEW_SKIP_DRAFTS',
	'AI_REVIEW_FAIL_ON_INCOMPLETE',
	'AI_REVIEW_VERIFY_PASS',
	'AI_REVIEW_VERIFY_MIN_SEVERITY',
	'AI_REVIEW_ENABLE_PRELINT',
	'AI_REVIEW_PROFILE',
	'PI_CODING_AGENT_DIR',
] as const;

function prContext(overrides: Record<string, unknown> = {}) {
	return {
		pullRequest: {
			number: 7,
			title: 'Add feature',
			body: 'body',
			draft: false,
			headSha: 'head-sha',
			baseSha: 'base-sha',
		},
		diff: {
			files: [
				{
					filename: 'src/a.ts',
					status: 'modified',
					additions: 1,
					deletions: 0,
					patch: '@@ -1 +1 @@\n-a\n+b',
				},
			],
		},
		...overrides,
	};
}

function cleanResult(overrides: Record<string, unknown> = {}) {
	return {
		findings: [],
		summary: 'ok',
		risk: 'none',
		counts: { critical: 0, high: 0, medium: 0, low: 0 },
		filesReviewed: ['src/a.ts'],
		...overrides,
	};
}

describe('main: top-level flows', () => {
	const saved: Record<string, string | undefined> = {};
	let inputs: Record<string, string>;
	let warning: ReturnType<typeof vi.spyOn>;
	let setFailed: ReturnType<typeof vi.spyOn>;
	let setOutput: ReturnType<typeof vi.spyOn>;
	let info: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		for (const key of ENV_KEYS) {
			saved[key] = process.env[key];
			Reflect.deleteProperty(process.env, key);
		}
		process.env.GITHUB_WORKSPACE = process.cwd();
		inputs = { 'github-token': 'tok', 'openai-api-key': 'key' };
		state.payload = { action: 'opened', pull_request: { number: 7 } };
		state.pr = prContext();
		state.runReview.mockReset().mockResolvedValue(cleanResult());
		state.publishReview.mockClear();
		state.cleanup.mockClear();
		state.applyVerify = undefined;
		state.runSecurityWorkflow.mockReset();
		state.publishSecurityReview.mockClear();
		state.updatePrContent.mockReset().mockResolvedValue(undefined);
		state.complete
			.mockReset()
			.mockResolvedValue({ content: '{}', finishReason: 'stop' });
		vi.spyOn(core, 'getInput').mockImplementation(
			(name: string) => inputs[name] ?? ''
		);
		warning = vi.spyOn(core, 'warning').mockImplementation(() => {});
		setFailed = vi.spyOn(core, 'setFailed').mockImplementation(() => {});
		setOutput = vi.spyOn(core, 'setOutput').mockImplementation(() => {});
		info = vi.spyOn(core, 'info').mockImplementation(() => {});
		vi.spyOn(core, 'notice').mockImplementation(() => {});
		vi.spyOn(core.summary, 'addRaw').mockReturnValue(core.summary);
		vi.spyOn(core.summary, 'write').mockResolvedValue(core.summary);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		for (const key of ENV_KEYS) {
			if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
			else process.env[key] = saved[key];
		}
	});

	it('skips an unsupported event with a warning and no failure', async () => {
		process.env.GITHUB_EVENT_NAME = 'push';
		await main(['pr-review']);
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining('Unsupported event push')
		);
		expect(setFailed).not.toHaveBeenCalled();
		expect(state.runReview).not.toHaveBeenCalled();
	});

	it('skips an actor rejected by the actor filter', async () => {
		process.env.GITHUB_ACTOR = 'renovate[bot]';
		await main(['pr-review']);
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining('[review] Skipping review:')
		);
		expect(state.runReview).not.toHaveBeenCalled();
		expect(setOutput).not.toHaveBeenCalled();
	});

	it('fails when the review runs outside a pull request', async () => {
		state.payload = { action: 'opened' };
		await main(['pr-review']);
		expect(setFailed).toHaveBeenCalledWith(
			'This action only runs on pull requests'
		);
	});

	it('skips a draft pull request when AI_REVIEW_SKIP_DRAFTS=true', async () => {
		process.env.AI_REVIEW_SKIP_DRAFTS = 'true';
		state.pr = prContext({
			pullRequest: { ...prContext().pullRequest, draft: true },
		});
		await main(['pr-review']);
		expect(info).toHaveBeenCalledWith(
			expect.stringContaining('PR #7 is a draft')
		);
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			'skipped: draft pull request'
		);
		expect(state.runReview).not.toHaveBeenCalled();
	});

	it('reports an empty selection as skipped', async () => {
		state.pr = prContext({
			diff: { files: [{ filename: 'src/a.ts', status: 'modified' }] },
		});
		await main(['pr-review']);
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			'skipped: no files to review'
		);
		expect(state.runReview).not.toHaveBeenCalled();
	});

	it('runs a normal review, publishes it, and restores the runtime', async () => {
		await main(['pr-review']);
		expect(state.runReview).toHaveBeenCalledTimes(1);
		expect(state.publishReview).toHaveBeenCalledTimes(1);
		expect(state.publishReview.mock.calls[0]?.[1]).toMatchObject({
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'head-sha',
			filesTotal: 1,
			filesExcluded: 0,
			filesSelected: 1,
		});
		expect(setOutput).toHaveBeenCalledWith('review-report', expect.any(String));
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			'1 files reviewed, 0 issues found'
		);
		expect(setFailed).not.toHaveBeenCalled();
		expect(state.cleanup).toHaveBeenCalledTimes(1);
		expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
	});

	it('fails the step when the review is incomplete', async () => {
		state.runReview.mockResolvedValue(
			cleanResult({ diagnostics: { failedGroups: 1 } })
		);
		await main(['pr-review']);
		expect(setFailed).toHaveBeenCalledWith(
			expect.stringContaining('Review incomplete (1 review group(s) failed')
		);
		expect(state.cleanup).toHaveBeenCalledTimes(1);
	});

	it('only warns about an incomplete review when AI_REVIEW_FAIL_ON_INCOMPLETE=false', async () => {
		process.env.AI_REVIEW_FAIL_ON_INCOMPLETE = 'false';
		state.runReview.mockResolvedValue(
			cleanResult({ diagnostics: { failedGroups: 1 } })
		);
		await main(['pr-review']);
		expect(setFailed).not.toHaveBeenCalled();
		expect(warning).toHaveBeenCalledWith(
			expect.stringContaining('Review incomplete')
		);
	});

	describe('verify pass', () => {
		const finding = (severity: string, title: string, line: number) => ({
			severity,
			confidence: 0.9,
			category: 'correctness',
			path: 'src/a.ts',
			line,
			title,
			description: 'd',
			impact: 'i',
		});
		const withFindings = () =>
			cleanResult({
				findings: [
					finding('high', 'High finding title', 1),
					finding('medium', 'Medium finding title', 2),
				],
				counts: { critical: 0, high: 1, medium: 1, low: 0 },
			});
		/** Approves every candidate named in the prompt that was sent. */
		const approveAll = async (messages: Array<{ content: string }>) => {
			const prompt = messages[0]?.content ?? '';
			const block = /```json\n([\s\S]*?)\n```/.exec(prompt)?.[1] ?? '[]';
			const verdicts = (JSON.parse(block) as Array<{ id: string }>).map(
				(c) => ({
					id: c.id,
					verified: true,
					reason: 'ok',
				})
			);
			return { content: JSON.stringify({ verdicts }), finishReason: 'stop' };
		};
		const sentPrompt = () =>
			(state.complete.mock.calls[0]?.[0] as Array<{ content: string }>)[0]
				.content;

		it('marks the review incomplete and fails the step when the verify pass throws', async () => {
			process.env.AI_REVIEW_VERIFY_PASS = 'true';
			state.runReview.mockResolvedValue(withFindings());
			state.applyVerify = async () => {
				throw new Error('verify exploded\nwith detail');
			};
			await main(['pr-review']);
			expect(setFailed).toHaveBeenCalledWith(
				expect.stringContaining('Review incomplete')
			);
			expect(warning).toHaveBeenCalledWith(
				expect.stringContaining('verify pass failed')
			);
			const summary = vi
				.mocked(core.summary.addRaw)
				.mock.calls.map((c) => String(c[0]))
				.join('\n');
			expect(summary).toContain(
				'verify pass failed: verify exploded with detail'
			);
			expect(state.publishReview).toHaveBeenCalledTimes(1);
		});

		it('only warns about a verify outage when AI_REVIEW_FAIL_ON_INCOMPLETE=false', async () => {
			process.env.AI_REVIEW_VERIFY_PASS = 'true';
			process.env.AI_REVIEW_FAIL_ON_INCOMPLETE = 'false';
			state.runReview.mockResolvedValue(withFindings());
			state.applyVerify = async () => {
				throw new Error('verify exploded');
			};
			await main(['pr-review']);
			expect(setFailed).not.toHaveBeenCalled();
			expect(state.publishReview).toHaveBeenCalledTimes(1);
		});

		it('sends only high and critical findings to verify by default', async () => {
			process.env.AI_REVIEW_VERIFY_PASS = 'true';
			state.runReview.mockResolvedValue(withFindings());
			state.complete.mockImplementation(approveAll);
			await main(['pr-review']);
			expect(state.complete).toHaveBeenCalledTimes(1);
			expect(sentPrompt()).toContain('High finding title');
			expect(sentPrompt()).not.toContain('Medium finding title');
		});

		it('honours AI_REVIEW_VERIFY_MIN_SEVERITY=medium end to end', async () => {
			process.env.AI_REVIEW_VERIFY_PASS = 'true';
			process.env.AI_REVIEW_VERIFY_MIN_SEVERITY = 'medium';
			state.runReview.mockResolvedValue(withFindings());
			state.complete.mockImplementation(approveAll);
			await main(['pr-review']);
			expect(sentPrompt()).toContain('High finding title');
			expect(sentPrompt()).toContain('Medium finding title');
			expect(setFailed).not.toHaveBeenCalled();
		});
	});

	it('reports a publish failure as an action failure and still cleans up', async () => {
		state.publishReview.mockRejectedValueOnce(new Error('boom'));
		await main(['pr-review']);
		expect(setFailed).toHaveBeenCalledWith('Action failed: boom');
		expect(state.cleanup).toHaveBeenCalledTimes(1);
	});

	it('runs the security flow and sets its outputs', async () => {
		inputs.mode = 'security';
		state.runSecurityWorkflow.mockResolvedValue({
			findings: [{ id: 'f1' }],
			summaryMarkdown: '## Security summary',
			sarifPath: 'out.sarif',
			reportPath: undefined,
			conclusion: {
				risk: 'high',
				incomplete: false,
				failThresholdReached: false,
			},
		});
		await main(['pr-review']);
		expect(state.runSecurityWorkflow).toHaveBeenCalledTimes(1);
		const context = state.runSecurityWorkflow.mock.calls[0]?.[0];
		expect(context).toMatchObject({
			owner: 'acme',
			repo: 'widget',
			prNumber: 7,
			headSha: 'head-sha',
			baseSha: undefined,
		});
		expect(setOutput).toHaveBeenCalledWith(
			'security_findings',
			JSON.stringify([{ id: 'f1' }])
		);
		expect(setOutput).toHaveBeenCalledWith('security_findings_count', '1');
		expect(setOutput).toHaveBeenCalledWith('security_risk', 'high');
		expect(setOutput).toHaveBeenCalledWith('security_sarif_path', 'out.sarif');
		expect(setOutput).not.toHaveBeenCalledWith(
			'security_report_path',
			expect.anything()
		);
		expect(setOutput).toHaveBeenCalledWith(
			'review-summary',
			'1 security finding(s) validated (Risk: high)'
		);
		expect(setFailed).not.toHaveBeenCalled();
		expect(state.runReview).not.toHaveBeenCalled();
	});

	it('fails the security flow when the analysis is incomplete', async () => {
		inputs.mode = 'security';
		state.runSecurityWorkflow.mockResolvedValue({
			findings: [],
			summaryMarkdown: '## Security summary',
			conclusion: { risk: 'none', incomplete: true },
		});
		await main(['pr-review']);
		expect(setFailed).toHaveBeenCalledWith(
			'Security review incomplete: one or more required analysis components failed.'
		);
	});

	it('runs the pr-content flow and sets its summary output', async () => {
		await main(['pr-content']);
		expect(state.complete).toHaveBeenCalledTimes(1);
		expect(state.updatePrContent).toHaveBeenCalledTimes(1);
		expect(setOutput).toHaveBeenCalledWith(
			'pr-content-summary',
			expect.stringContaining('- **Status:** updated')
		);
		expect(setFailed).not.toHaveBeenCalled();
	});

	it('retries pr-content with a doubled default budget when the answer is truncated', async () => {
		state.complete
			.mockResolvedValueOnce({ content: '', finishReason: 'length' })
			.mockResolvedValueOnce({ content: '{}', finishReason: 'stop' });
		await main(['pr-content']);
		expect(state.complete).toHaveBeenCalledTimes(2);
		expect(state.complete.mock.calls[1]?.[1]).toMatchObject({
			maxOutputTokens: 2000,
		});
		expect(warning).toHaveBeenCalledWith(
			'AI response truncated or empty; retrying with max_tokens=2000'
		);
	});

	it('fails pr-content outside a pull request', async () => {
		state.payload = { action: 'opened' };
		await main(['pr-content']);
		expect(setFailed).toHaveBeenCalledWith(
			'This action only runs on pull requests'
		);
		expect(state.complete).not.toHaveBeenCalled();
	});
});
