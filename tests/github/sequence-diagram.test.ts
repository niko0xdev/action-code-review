import { describe, expect, it } from 'vitest';
import {
	diagramSection,
	stripDiagramSection,
	validateSequenceDiagram,
} from '../../src/github/sequence-diagram.js';

const VALID = [
	'sequenceDiagram',
	'autonumber',
	'actor User',
	'participant API as Review API',
	'User->>API: POST /review (diff)',
	'alt cached',
	'API-->>User: cached result',
	'else fresh',
	'loop each file group',
	'API->>API: analyse group',
	'end',
	'Note over User, API: findings are redacted',
	'end',
	'opt auto-approve',
	'Note right of API: approve when resolved',
	'end',
].join('\n');

describe('validateSequenceDiagram', () => {
	it('accepts the safe grammar and normalises indentation', () => {
		const result = validateSequenceDiagram(VALID);
		expect(result).toBeDefined();
		const lines = result?.split('\n') ?? [];
		expect(lines[0]).toBe('sequenceDiagram');
		expect(lines).toContain('    User->>API: POST /review (diff)');
		expect(lines).toContain('            API->>API: analyse group');
		expect(lines).toHaveLength(VALID.split('\n').length);
	});

	it('unwraps a single mermaid fence around an otherwise valid diagram', () => {
		expect(
			validateSequenceDiagram('```mermaid\nsequenceDiagram\n  A->>B: hi\n```')
		).toBe('sequenceDiagram\n    A->>B: hi');
	});

	it.each([
		['empty', ''],
		['not a sequence diagram', 'flowchart TD\n  A-->B'],
		['click directive', 'sequenceDiagram\nA->>B: hi\nclick A "https://evil"'],
		['link directive', 'sequenceDiagram\nlink A: Docs @ https://evil'],
		['links directive', 'sequenceDiagram\nlinks A: {"x": "https://evil"}'],
		[
			'init directive',
			'%%{init: {"securityLevel": "loose"}}%%\nsequenceDiagram',
		],
		['init after header', 'sequenceDiagram\n%%{init: {"theme": "x"}}%%'],
		['comment', 'sequenceDiagram\n%% hidden\nA->>B: hi'],
		['HTML image', 'sequenceDiagram\nA->>B: <img src=x onerror=alert(1)>'],
		['HTML break', 'sequenceDiagram\nNote over A: one<br/>two'],
		['entity', 'sequenceDiagram\nA->>B: &lt;script&gt;'],
		['mermaid entity code', 'sequenceDiagram\nA->>B: #60;script#62;'],
		['backtick', 'sequenceDiagram\nA->>B: run `rm -rf`'],
		['nested fence', '```mermaid\nsequenceDiagram\n```\nA->>B: x\n```'],
		['URL', 'sequenceDiagram\nA->>B: see https://evil.example'],
		['bare www', 'sequenceDiagram\nA->>B: see www.evil.example'],
		['javascript scheme', 'sequenceDiagram\nA->>B: javascript:alert(1)'],
		['statement separator', 'sequenceDiagram\nA->>B: hi; click A call x()'],
		['braces', 'sequenceDiagram\nA->>B: {x}'],
		['unknown arrow', 'sequenceDiagram\nA-xB: lost'],
		['unbalanced end', 'sequenceDiagram\nA->>B: hi\nend'],
		['unclosed block', 'sequenceDiagram\nloop forever\nA->>B: hi'],
		['else outside alt', 'sequenceDiagram\nopt x\nelse y\nend'],
		['control character', 'sequenceDiagram\nA->>B: hi‮'],
		['too many lines', `sequenceDiagram\n${'A->>B: hi\n'.repeat(30)}`],
		['too many characters', `sequenceDiagram\nA->>B: ${'x'.repeat(2000)}`],
	])('rejects %s', (_name, input) => {
		expect(validateSequenceDiagram(input)).toBeUndefined();
	});
});

describe('diagram section', () => {
	it('renders a labelled mermaid block and strips it again', () => {
		const section = diagramSection('sequenceDiagram\n    A->>B: hi');
		expect(section).toBe(
			'\n\n### Change flow (generated)\n\n```mermaid\nsequenceDiagram\n    A->>B: hi\n```'
		);
		expect(stripDiagramSection(`Body${section}\n\nTail`)).toBe('Body\n\nTail');
	});
});
