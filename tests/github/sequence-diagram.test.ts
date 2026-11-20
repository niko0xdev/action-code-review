import { describe, expect, it } from 'vitest';
import {
	describeSequenceDiagram,
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
	});

	it('accepts the text a real description contains', () => {
		const result = validateSequenceDiagram(
			[
				'sequenceDiagram',
				'participant api as Review API',
				'api->>worker: update PR #171',
				'worker-->>api: title & body are ready',
				'api->>worker: 50% faster',
				'worker-->>api: size < 64 KiB',
				'api->>+worker: start',
				'worker-->>-api: stop',
				'Note over api: keep {title, body}',
				'note over api, worker: done',
				'api->>worker:',
			].join('\n')
		);
		expect(result).toBeDefined();
		// Mermaid reads a bare `#` as the start of a comment; the entity keeps it.
		expect(result).toContain('update PR #35;171');
		expect(result).toContain('title & body are ready');
		expect(result).toContain('50% faster');
		expect(result).toContain('size < 64 KiB');
		expect(result).toContain('api->>+worker: start');
		expect(result).toContain('worker-->>-api: stop');
		expect(result).toContain('keep {title, body}');
	});

	it('rewrites a participant name Mermaid cannot parse', () => {
		const result = validateSequenceDiagram(
			['sequenceDiagram', 'octokit.rest->>api: call'].join('\n')
		);
		expect(result).toBeDefined();
		expect(result).toContain('participant P1 as octokit.rest');
		expect(result).toContain('P1->>api: call');
	});

	it('rewrites a participant named after a Mermaid keyword', () => {
		const result = validateSequenceDiagram(
			['sequenceDiagram', 'end->>B: x'].join('\n')
		);
		expect(result).toBeDefined();
		expect(result).toContain('participant P1 as end');
		expect(result).toContain('P1->>B: x');
	});

	it('keeps "of" in left and right note placements', () => {
		const result = validateSequenceDiagram(
			['sequenceDiagram', 'Note left of A: x', 'note RIGHT OF B: y'].join('\n')
		);
		expect(result).toBe(
			'sequenceDiagram\n    Note left of A: x\n    Note right of B: y'
		);
	});

	it.each(['End', 'OPT', 'Loop', 'option', 'par_over', 'title', 'off'])(
		'rewrites %s, which the case-insensitive Mermaid lexer reads as a keyword',
		(name) => {
			const result = validateSequenceDiagram(
				['sequenceDiagram', `${name}->>B: x`].join('\n')
			);
			expect(result).toContain(`participant P1 as ${name}`);
			expect(result).toContain('P1->>B: x');
		}
	);

	it('encodes # in labels and block text as well as messages', () => {
		const result = validateSequenceDiagram(
			[
				'sequenceDiagram',
				'participant gh as GitHub #1',
				'alt PR #2',
				'gh->>gh: x',
				'else issue #3',
				'Note over gh: see #4',
				'end',
			].join('\n')
		);
		expect(result).toContain('participant gh as GitHub #35;1');
		expect(result).toContain('alt PR #35;2');
		expect(result).toContain('else issue #35;3');
		expect(result).toContain('Note over gh: see #35;4');
	});

	it('accepts a realistic model answer with activations and blank lines', () => {
		const check = describeSequenceDiagram(
			[
				'```mermaid',
				'sequenceDiagram',
				'    autonumber',
				'    actor Dev as Developer',
				'    participant gh as GitHub',
				'    participant pr-content as pr-content action',
				'',
				'    Dev->>gh: push to PR #171',
				'    gh->>+pr-content: pull_request (synchronize)',
				'    pr-content->>pr-content: build prompt (diff < 2,000 chars/file)',
				'    alt diagram enabled & valid',
				'        pr-content-->>gh: title & body + diagram',
				'    else rejected',
				'        Note right of pr-content: section omitted (logged)',
				'    end',
				'    pr-content-->>-gh: done, 50% fewer edits',
				'```',
			].join('\n')
		);
		expect(check.error).toBeUndefined();
		expect(check.diagram).toContain('participant P1 as pr-content action');
		expect(check.diagram).toContain('gh->>+P1: pull_request (synchronize)');
		expect(check.diagram).toContain('P1-->>-gh: done, 50% fewer edits');
	});

	it('rejects a deactivation of a participant that is not active', () => {
		const check = describeSequenceDiagram(
			['sequenceDiagram', 'A->>B: hi', '', 'B-->>-A: done'].join('\n')
		);
		expect(check.diagram).toBeUndefined();
		expect(check.error).toContain('line 4');
		expect(check.error).toContain('not active');
	});

	it('numbers lines as they appear in the diagram, blank lines included', () => {
		const check = describeSequenceDiagram(
			[
				'```mermaid',
				'sequenceDiagram',
				'',
				'A->>B: hi',
				'',
				'A->>B: <b>x</b>',
				'```',
			].join('\n')
		);
		expect(check.error).toContain('line 5');
	});

	it('reports the offending line and the reason', () => {
		const check = describeSequenceDiagram(
			['sequenceDiagram', 'A->>B: hi', 'A->>B: <script>x</script>'].join('\n')
		);
		expect(check.diagram).toBeUndefined();
		expect(check.error).toContain('line 3');
		expect(check.error).toContain('HTML');
	});

	it('accepts a fence with CRLF line endings', () => {
		expect(
			validateSequenceDiagram(
				'```mermaid\r\nsequenceDiagram\r\n  A->>B: hi\r\n```'
			)
		).toBe('sequenceDiagram\n    A->>B: hi');
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
		['backtick', 'sequenceDiagram\nA->>B: run `rm -rf`'],
		['nested fence', '```mermaid\nsequenceDiagram\n```\nA->>B: x\n```'],
		['URL', 'sequenceDiagram\nA->>B: see https://evil.example'],
		['bare www', 'sequenceDiagram\nA->>B: see www.evil.example'],
		['javascript scheme', 'sequenceDiagram\nA->>B: javascript:alert(1)'],
		[
			'legacy entity without semicolon',
			'sequenceDiagram\nA->>B: &ltimg src=x&gt',
		],
		['numeric entity prefix', 'sequenceDiagram\nA->>B: &#60'],
		['statement separator', 'sequenceDiagram\nA->>B: hi; click A call x()'],
		[
			'mermaid participant metadata',
			'sequenceDiagram\nparticipant A@{ "shape": "rect" }',
		],
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

	it('leaves user content alone when a copied section lost its closing fence', () => {
		const body = [
			'Intro',
			'',
			'### Change flow (generated)',
			'',
			'```mermaid',
			'sequenceDiagram',
			'A->>B: x',
			'',
			'## Testing',
			'',
			'```ts',
			'const a = 1;',
			'```',
			'Tail',
		].join('\n');
		expect(stripDiagramSection(body)).toBe(body);
	});

	it('strips a copied section that used CRLF line endings', () => {
		const body = [
			'Intro',
			'',
			'### Change flow (generated)',
			'',
			'```mermaid',
			'sequenceDiagram',
			'A->>B: x',
			'```',
			'',
			'Tail',
		].join('\r\n');
		expect(stripDiagramSection(body)).toBe('Intro\r\n\r\nTail');
	});
});
