/**
 * Opt-in Mermaid sequence diagram for the generated PR description
 * (`AI_PR_CONTENT_DIAGRAM=true`). The diagram is model output, so it is
 * untrusted: a small statement grammar is accepted, participant names that
 * Mermaid cannot parse are rewritten to safe aliases, and anything else is
 * dropped with a reason instead of being published.
 */

const MAX_LINES = 30;
const MAX_CHARS = 2000;
const MAX_EMITTED_CHARS = 4000;
const HEADING = '### Change flow (generated)';

/** A participant name Mermaid can use as-is. */
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Words Mermaid gives a meaning. A participant named after one of them
 * renders as an error, so such a name is rewritten too.
 */
const RESERVED = new Set([
	'sequenceDiagram',
	'autonumber',
	'participant',
	'actor',
	'note',
	'alt',
	'else',
	'opt',
	'loop',
	'par',
	'and',
	'end',
	'rect',
	'box',
	'critical',
	'break',
	'activate',
	'deactivate',
	'create',
	'destroy',
	'link',
	'links',
	'click',
	'class',
	'classDef',
	'state',
	'callback',
	'href',
	'over',
	'left',
	'right',
	'of',
	'as',
]);

/**
 * Text Mermaid accepts as a message: no HTML, entities, directives, statement
 * separators, or fences. A comparison such as `size < 64 KiB` is allowed; only
 * a tag-like `<` is rejected.
 */
const FORBIDDEN_TEXT =
	/%%|;|`|\\|:\/\/|www\.|javascript:|data:[\w.+-]+\/|[\p{Cc}\p{Cf}]|<[A-Za-z/!]|&(?:[a-zA-Z]{2,10}|#\d{1,6});|@\{/iu;

type Statement =
	| { kind: 'header' }
	| { kind: 'autonumber' }
	| {
			kind: 'participant';
			id: string;
			label?: string;
			actor: boolean;
	  }
	| {
			kind: 'message';
			from: string;
			to: string;
			arrow: string;
			activation: string;
			text?: string;
	  }
	| {
			kind: 'note';
			placement: 'over' | 'left' | 'right';
			ids: string[];
			text?: string;
	  }
	| { kind: 'open'; keyword: 'alt' | 'opt' | 'loop'; label?: string }
	| { kind: 'else'; label?: string }
	| { kind: 'end' };

interface ParseFailure {
	error: string;
}

type ParseResult = { statements: Statement[] } | ParseFailure;

const MESSAGE =
	/^([A-Za-z_][A-Za-z0-9_.-]*?)\s*(--?>>?)\s*([+-]?)\s*([A-Za-z_][A-Za-z0-9_.-]*?)\s*:\s*(.*)$/;
const PARTICIPANT =
	/^(participant|actor)\s+([A-Za-z_][A-Za-z0-9_.-]*)(?:\s+as\s+(.*))?$/i;
const NOTE =
	/^Note\s+(over|left of|right of)\s+([A-Za-z_][A-Za-z0-9_.-]*)(?:\s*,\s*([A-Za-z_][A-Za-z0-9_.-]*))?\s*:\s*(.*)$/i;
const BLOCK_OPEN = /^(alt|opt|loop)(?:\s+(.*))?$/i;
const BLOCK_ELSE = /^else(?:\s+(.*))?$/i;

function textProblem(text: string): string | undefined {
	if (FORBIDDEN_TEXT.test(text))
		return 'it contains HTML, an entity, a directive, a link, or a statement separator';
	return undefined;
}

/** Parse one line into a statement, or explain why the line is not accepted. */
function parseLine(line: string): Statement | ParseFailure {
	const message = MESSAGE.exec(line);
	if (message) {
		const [, from, arrow, activation, to, text] = message;
		const problem = textProblem(text);
		if (problem) return { error: `the message text ${problem}` };
		return {
			kind: 'message',
			from,
			to,
			arrow,
			activation,
			text: text.trim() || undefined,
		};
	}
	const participant = PARTICIPANT.exec(line);
	if (participant) {
		const [, keyword, id, label] = participant;
		const problem = textProblem(label ?? '');
		if (problem) return { error: `the participant label ${problem}` };
		return {
			kind: 'participant',
			id,
			label: label?.trim() || undefined,
			actor: keyword.toLowerCase() === 'actor',
		};
	}
	const note = NOTE.exec(line);
	if (note) {
		const [, placement, first, second, text] = note;
		const problem = textProblem(text);
		if (problem) return { error: `the note text ${problem}` };
		const kind = placement.toLowerCase();
		return {
			kind: 'note',
			placement:
				kind === 'over' ? 'over' : kind === 'left of' ? 'left' : 'right',
			ids: second ? [first, second] : [first],
			text: text.trim() || undefined,
		};
	}
	const open = BLOCK_OPEN.exec(line);
	if (open) {
		const [, keyword, label] = open;
		const problem = textProblem(label ?? '');
		if (problem) return { error: `the block label ${problem}` };
		return {
			kind: 'open',
			keyword: keyword.toLowerCase() as 'alt' | 'opt' | 'loop',
			label: label?.trim() || undefined,
		};
	}
	const otherwise = BLOCK_ELSE.exec(line);
	if (otherwise) {
		const label = otherwise[1];
		const problem = textProblem(label ?? '');
		if (problem) return { error: `the else label ${problem}` };
		return { kind: 'else', label: label?.trim() || undefined };
	}
	if (line.toLowerCase() === 'end') return { kind: 'end' };
	if (line.toLowerCase() === 'autonumber') return { kind: 'autonumber' };
	return { error: 'it is not a statement of the accepted grammar' };
}

/**
 * Parse a diagram into statements. Block structure is checked here: `else`
 * only inside `alt`, and every block closed.
 */
function parseDiagram(lines: string[]): ParseResult {
	const statements: Statement[] = [];
	const stack: Array<'alt' | 'opt' | 'loop'> = [];
	for (const [index, line] of lines.entries()) {
		const parsed = parseLine(line);
		if ('error' in parsed)
			return { error: `line ${index + 2} (${line}) ${parsed.error}` };
		if (parsed.kind === 'end') {
			if (stack.pop() === undefined)
				return {
					error: `line ${index + 2} closes a block that was never opened`,
				};
		} else if (parsed.kind === 'else') {
			if (stack.at(-1) !== 'alt')
				return { error: `line ${index + 2} uses else outside an alt block` };
		} else if (parsed.kind === 'open') {
			stack.push(parsed.keyword);
		}
		statements.push(parsed);
	}
	if (stack.length > 0) return { error: 'a block is never closed with end' };
	return { statements };
}

/**
 * Rewrite the diagram into one Mermaid can render: participant names that are
 * not safe identifiers, or that collide with a Mermaid keyword, become an
 * alias with the original name as its label.
 */
function render(statements: Statement[]): string {
	const alias = new Map<string, string>();
	let aliasCount = 0;
	const declared = new Map<string, { label?: string; actor: boolean }>();
	const order: string[] = [];
	const nameOf = (id: string): string => {
		const existing = alias.get(id);
		if (existing) return existing;
		const safe = SAFE_ID.test(id) && !RESERVED.has(id);
		const name = safe ? id : `P${aliasCount + 1}`;
		if (!safe) aliasCount += 1;
		alias.set(id, name);
		order.push(id);
		return name;
	};
	for (const statement of statements) {
		if (statement.kind === 'participant')
			declared.set(statement.id, {
				label: statement.label,
				actor: statement.actor,
			});
	}
	const lines: string[] = ['sequenceDiagram'];
	const body: string[] = [];
	const depth = { value: 0 };
	const indent = () => '    '.repeat(depth.value + 1);
	for (const statement of statements) {
		switch (statement.kind) {
			case 'header':
				break;
			case 'autonumber':
				body.push(`${indent()}autonumber`);
				break;
			case 'participant': {
				const name = nameOf(statement.id);
				const label = statement.label ?? statement.id;
				body.push(
					`${indent()}${statement.actor ? 'actor' : 'participant'} ${name} as ${label}`
				);
				break;
			}
			case 'message':
				body.push(
					`${indent()}${nameOf(statement.from)}${statement.arrow}${statement.activation}${nameOf(statement.to)}${statement.text ? `: ${statement.text}` : ''}`
				);
				break;
			case 'note': {
				const names = statement.ids.map(nameOf).join(', ');
				body.push(
					`${indent()}Note ${statement.placement} ${names}${statement.text ? `: ${statement.text}` : ''}`
				);
				break;
			}
			case 'open':
				body.push(
					`${indent()}${statement.keyword}${statement.label ? ` ${statement.label}` : ''}`
				);
				depth.value += 1;
				break;
			case 'else':
				body.push(
					`${'    '.repeat(depth.value)}else${statement.label ? ` ${statement.label}` : ''}`
				);
				break;
			case 'end':
				depth.value = Math.max(depth.value - 1, 0);
				body.push(`${indent()}end`);
				break;
		}
	}
	// Declarations for rewritten names come first, so the diagram reads well.
	const declarations: string[] = [];
	for (const id of order) {
		const name = alias.get(id);
		if (!name || name === id) continue;
		const known = declared.get(id);
		declarations.push(`    participant ${name} as ${known?.label ?? id}`);
	}
	lines.push(...declarations);
	lines.push(...body);
	return lines.join('\n');
}

export interface SequenceDiagramCheck {
	/** The normalised diagram, when the text is acceptable. */
	diagram?: string;
	/** Why the text was not acceptable, with the offending line. */
	error?: string;
}

/**
 * Check a model-supplied diagram. The result is either a normalised diagram or
 * the reason it was rejected; the caller drops the diagram and logs the reason.
 */
export function describeSequenceDiagram(raw: string): SequenceDiagramCheck {
	const text = raw
		.replace(/\r\n/g, '\n')
		.trim()
		.replace(/^```(?:mermaid)?\n([\s\S]*)\n```$/, '$1')
		.trim();
	if (!text) return { error: 'the diagram is empty' };
	if (text.length > MAX_CHARS)
		return {
			error: `the diagram is longer than ${MAX_CHARS} characters`,
		};
	const lines = text
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length > MAX_LINES)
		return { error: `the diagram has more than ${MAX_LINES} lines` };
	if (lines[0] !== 'sequenceDiagram')
		return { error: 'the first line is not sequenceDiagram' };
	const parsed = parseDiagram(lines.slice(1));
	if ('error' in parsed) return { error: parsed.error };
	const diagram = render(parsed.statements);
	if (diagram.length > MAX_EMITTED_CHARS)
		return { error: 'the diagram is too long once normalised' };
	return { diagram };
}

/**
 * Returns a normalised diagram, or undefined when the text is not a short
 * `sequenceDiagram` made only of the accepted statements.
 */
export function validateSequenceDiagram(raw: string): string | undefined {
	return describeSequenceDiagram(raw).diagram;
}

/** The labelled description section that carries a validated diagram. */
export function diagramSection(diagram: string): string {
	return `\n\n${HEADING}\n\n\`\`\`mermaid\n${diagram}\n\`\`\``;
}

/**
 * Removes a generated section the model copied from the current body. The
 * closing fence must end its line, so a section copied without it is left
 * alone rather than eating the content that follows it.
 */
export function stripDiagramSection(description: string): string {
	return description.replace(
		/(?:\r?\n)*### Change flow \(generated\)(?:\r?\n)+```mermaid\r?\n[^`]*?\r?\n```(?=\r?\n|$)/g,
		''
	);
}
