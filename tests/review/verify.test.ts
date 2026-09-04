import { describe, expect, it } from 'vitest';
import {
	buildVerifyPrompt,
	estimateCostUsd,
	runVerifyPass,
} from '../../src/review/verify.js';
import type { Finding, ToolFinding } from '../../src/types/finding.js';

function mkFinding(overrides: Partial<Finding> = {}): Finding {
	return {
		severity: 'high',
		confidence: 0.9,
		category: 'correctness',
		path: 'src/app.ts',
		line: 10,
		title: 'Bug',
		description: 'd',
		impact: 'i',
		...overrides,
	};
}

const ctx = {
	title: 'Test PR',
	body: 'Fix something',
	filenames: ['src/app.ts'],
};

describe('estimateCostUsd', () => {
	it('estimates cost from input + output tokens', () => {
		const cost = estimateCostUsd(1000, 500, 0.001);
		// (1000 + 500) / 1000 * 0.001 = 0.0015
		expect(cost).toBeCloseTo(0.0015, 6);
	});

	it('handles zero tokens', () => {
		expect(estimateCostUsd(0, 0, 0.002)).toBe(0);
	});
});

describe('buildVerifyPrompt', () => {
	it('includes PR title and candidate findings', () => {
		const prompt = buildVerifyPrompt([mkFinding()], [] as ToolFinding[], ctx);
		expect(prompt).toContain('Test PR');
		expect(prompt).toContain('"path": "src/app.ts"');
	});

	it('includes tool findings when present', () => {
		const prompt = buildVerifyPrompt(
			[mkFinding()],
			[
				{
					tool: 'biome',
					code: 'no-unused',
					path: 'src/app.ts',
					line: 5,
					severity: 'medium',
					message: 'unused var',
				},
			],
			ctx
		);
		expect(prompt).toContain('[biome/no-unused]');
	});

	it('omits tool findings section when empty', () => {
		const prompt = buildVerifyPrompt([mkFinding()], [] as ToolFinding[], ctx);
		expect(prompt).not.toContain('Static analyzer evidence');
	});
});

describe('runVerifyPass', () => {
	const emptyTool: ToolFinding[] = [];

	it('skips when no high/critical findings', async () => {
		const findings = [
			mkFinding({ severity: 'medium' }),
			mkFinding({ severity: 'low' }),
		];
		const result = await runVerifyPass({
			findings,
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => '{"findings":[]}',
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain('no high/critical');
		expect(result.findings).toBe(findings);
	});

	it('skips when cost exceeds budget', async () => {
		const findings = [mkFinding({ severity: 'high' })];
		const result = await runVerifyPass({
			findings,
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => '{"findings":[]}',
			inputTokenEstimate: 1_000_000, // huge
			outputTokenBudget: 1024,
			budgetUsd: 0.001,
		});
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain('budget');
	});

	it('skips when verify callback throws', async () => {
		const findings = [mkFinding({ severity: 'critical' })];
		const result = await runVerifyPass({
			findings,
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => {
				throw new Error('LLM down');
			},
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.skipped).toBe(true);
		expect(result.skipReason).toContain('verify call failed');
	});

	it('keeps verified high/critical findings', async () => {
		const target = mkFinding({
			severity: 'high',
			path: 'src/app.ts',
			line: 10,
			title: 'Important bug',
		});
		const result = await runVerifyPass({
			findings: [target],
			toolFindings: emptyTool,
			context: ctx,
			verify: async () =>
				JSON.stringify({
					findings: [
						{
							path: 'src/app.ts',
							line: 10,
							category: 'correctness',
							title: 'Important bug',
							verified: true,
						},
					],
				}),
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.skipped).toBe(false);
		expect(result.findings).toHaveLength(1);
		expect(result.verifiedCount).toBe(1);
		expect(result.droppedCount).toBe(0);
	});

	it('drops high/critical findings not returned by verify', async () => {
		const target = mkFinding({
			severity: 'high',
			path: 'src/app.ts',
			line: 10,
			title: 'Hallucinated bug',
		});
		const result = await runVerifyPass({
			findings: [target],
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => '{"findings":[]}',
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.findings).toHaveLength(0);
		expect(result.verifiedCount).toBe(0);
		expect(result.droppedCount).toBe(1);
	});

	it('keeps low/medium findings even if verify pass returns empty', async () => {
		const findings = [
			mkFinding({ severity: 'low' }),
			mkFinding({ severity: 'medium' }),
			mkFinding({ severity: 'high', title: 'To be dropped' }),
		];
		const result = await runVerifyPass({
			findings,
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => '{"findings":[]}',
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.findings).toHaveLength(2);
		expect(result.findings.map((f) => f.severity)).toEqual(['low', 'medium']);
	});

	it('handles malformed verify output gracefully', async () => {
		const findings = [mkFinding({ severity: 'critical' })];
		const result = await runVerifyPass({
			findings,
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => 'not json',
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.skipped).toBe(false);
		expect(result.findings).toHaveLength(0);
		expect(result.droppedCount).toBe(1);
	});

	it('ignores verify entries with verified=false', async () => {
		const findings = [mkFinding({ severity: 'critical' })];
		const result = await runVerifyPass({
			findings,
			toolFindings: emptyTool,
			context: ctx,
			verify: async () =>
				JSON.stringify({
					findings: [
						{
							path: 'src/app.ts',
							line: 10,
							category: 'correctness',
							title: 'Bug',
							verified: false,
						},
					],
				}),
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
		});
		expect(result.droppedCount).toBe(1);
		expect(result.findings).toHaveLength(0);
	});

	it('records estimatedCostUsd in result', async () => {
		const result = await runVerifyPass({
			findings: [mkFinding({ severity: 'high' })],
			toolFindings: emptyTool,
			context: ctx,
			verify: async () => '{"findings":[]}',
			inputTokenEstimate: 1000,
			outputTokenBudget: 1024,
			ratePer1K: 0.002,
		});
		// (1000 + 1024) / 1000 * 0.002 = 0.004048
		expect(result.estimatedCostUsd).toBeCloseTo(0.004048, 6);
	});
});
