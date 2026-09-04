import { describe, expect, it } from 'vitest';
import { classifyPrRisk } from '../../src/security/classifier/risk-classifier.js';

describe('RiskClassifier', () => {
	it('classifies low-risk changes with no security-sensitive paths', () => {
		const files = [
			{
				filename: 'src/components/Button.tsx',
				patch: '+export const Button = () => <button>Click</button>;',
			},
			{
				filename: 'docs/guide.md',
				patch: '+# Documentation guide',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('low');
		expect(result.domains).toHaveLength(0);
	});

	it('classifies critical surface for authentication and session changes', () => {
		const files = [
			{
				filename: 'src/auth/jwt-service.ts',
				patch: '+const token = jwt.verify(req.headers.token, secret);',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('critical_surface');
		expect(result.domains).toContain('authentication');
		expect(result.changedFiles).toContain('src/auth/jwt-service.ts');
	});

	it('classifies critical surface for process execution changes', () => {
		const files = [
			{
				filename: 'src/utils/exec-helper.ts',
				patch: '+const proc = child_process.exec(userCommand);',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('critical_surface');
		expect(result.domains).toContain('process-execution');
	});

	it('classifies critical surface for GitHub Actions workflow changes', () => {
		const files = [
			{
				filename: '.github/workflows/deploy.yml',
				patch: '+  pull_request_target:\n+    types: [opened]',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('critical_surface');
		expect(result.domains).toContain('cicd-security');
	});

	it('classifies high-risk for database query construction / raw SQL', () => {
		const files = [
			{
				filename: 'src/db/query-builder.ts',
				patch: '+const query = `SELECT * FROM users WHERE id = ${userId}`;',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('high');
		expect(result.domains).toContain('database-security');
	});

	it('classifies high-risk for network HTTP client changes', () => {
		const files = [
			{
				filename: 'src/services/webhook-dispatcher.ts',
				patch: '+await fetch(targetWebhookUrl, { method: "POST" });',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('high');
		expect(result.domains).toContain('network-boundary');
	});

	it('classifies medium-risk for dependency manifest changes', () => {
		const files = [
			{
				filename: 'package.json',
				patch: '+    "lodash": "^4.17.21"',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('medium');
		expect(result.domains).toContain('supply-chain');
	});

	it('combines multiple risk domains across diff files', () => {
		const files = [
			{
				filename: 'src/auth/roles.ts',
				patch: '+export function checkPermission(user, role) {}',
			},
			{
				filename: 'src/crypto/encrypt.ts',
				patch: '+const cipher = crypto.createCipher(algo, key);',
			},
			{
				filename: 'src/api/payment.ts',
				patch: '+await stripe.charges.create({});',
			},
		];
		const result = classifyPrRisk(files);
		expect(result.level).toBe('critical_surface');
		expect(result.domains).toContain('authorization');
		expect(result.domains).toContain('cryptography');
		expect(result.domains).toContain('payments');
		expect(result.reasons.length).toBeGreaterThanOrEqual(3);
	});
});
