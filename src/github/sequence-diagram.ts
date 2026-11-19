/**
 * Opt-in Mermaid sequence diagram for the generated PR description
 * (`AI_PR_CONTENT_DIAGRAM=true`). The diagram is model output, so it is
 * untrusted: only a small line grammar is accepted and anything else is
 * dropped, never published.
 */

const MAX_LINES = 30;
const MAX_CHARS = 2000;
const HEADING = '### Change flow (generated)';

const ID = '[A-Za-z_][A-Za-z0-9_]*';
// Free text: no HTML, entities, directives, statement separators, or fences.
const TEXT = '[^<>&#%;{}`\\\\]+';
const LINE_GRAMMAR = [
	/^autonumber$/,
	new RegExp(`^(?:participant|actor) ${ID}(?: as ${TEXT})?$`),
	new RegExp(`^${ID}\\s*--?>>\\s*${ID}\\s*:${TEXT}$`),
	new RegExp(
		`^Note (?:over|left of|right of) ${ID}(?:\\s*,\\s*${ID})?\\s*:${TEXT}$`
	),
];
const BLOCK_OPEN = new RegExp(`^(alt|opt|loop)(?: ${TEXT})?$`);
const BLOCK_ELSE = new RegExp(`^else(?: ${TEXT})?$`);
const FORBIDDEN = /:\/\/|www\.|javascript:|\bdata:[\w.+-]+\/|[\p{Cc}\p{Cf}]/iu;

/**
 * Returns a normalised diagram, or undefined when the text is not a short
 * `sequenceDiagram` made only of the accepted statements.
 */
export function validateSequenceDiagram(raw: string): string | undefined {
	const text = raw
		.trim()
		.replace(/^```(?:mermaid)?\n([\s\S]*)\n```$/, '$1')
		.trim();
	if (text.length > MAX_CHARS) return undefined;
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length > MAX_LINES || lines[0] !== 'sequenceDiagram')
		return undefined;
	const blocks: string[] = [];
	const out = ['sequenceDiagram'];
	for (const line of lines.slice(1)) {
		if (FORBIDDEN.test(line)) return undefined;
		const open = BLOCK_OPEN.exec(line);
		if (line === 'end') {
			if (!blocks.pop()) return undefined;
			out.push(`${'    '.repeat(blocks.length + 1)}${line}`);
		} else if (BLOCK_ELSE.test(line)) {
			if (blocks.at(-1) !== 'alt') return undefined;
			out.push(`${'    '.repeat(blocks.length)}${line}`);
		} else if (open) {
			out.push(`${'    '.repeat(blocks.length + 1)}${line}`);
			blocks.push(open[1]);
		} else if (LINE_GRAMMAR.some((rule) => rule.test(line))) {
			out.push(`${'    '.repeat(blocks.length + 1)}${line}`);
		} else return undefined;
	}
	return blocks.length === 0 ? out.join('\n') : undefined;
}

/** The labelled description section that carries a validated diagram. */
export function diagramSection(diagram: string): string {
	return `\n\n${HEADING}\n\n\`\`\`mermaid\n${diagram}\n\`\`\``;
}

/** Removes a generated section the model copied from the current body. */
export function stripDiagramSection(description: string): string {
	return description.replace(
		/\n*### Change flow \(generated\)\n+```mermaid\n[\s\S]*?\n```/g,
		''
	);
}
