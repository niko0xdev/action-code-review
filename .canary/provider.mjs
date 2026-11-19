import { createServer } from 'node:http';

// Canary-only controlled transport. Never use this as a source assessment.
// CANARY_MODE=clean returns an explicit empty findings envelope; CANARY_MODE=blocking
// returns one fixed critical finding so repeated runs on one head are comparable.
const mode = process.env.CANARY_MODE === 'blocking' ? 'blocking' : 'clean';
const paths = ['src/data/release-tenant.ts'];
const blockingFinding = {
	severity: 'critical',
	confidence: 0.95,
	category: 'security',
	path: 'src/data/release-tenant.ts',
	line: 7,
	title: 'Controlled canary finding: interpolated record identifier',
	description:
		'Controlled transport fixture. The record identifier is interpolated into the SQL text and the tenant is not constrained.',
	impact: 'Exercises blocking publication only; not a model-quality result.',
	suggestion: 'Bind tenant and record identifiers as query parameters.',
	replacement: null,
};
const server = createServer(async (request, response) => {
	if (request.url === '/health') {
		response.writeHead(200).end(`ready:${mode}`);
		return;
	}
	if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
		response.writeHead(404).end();
		return;
	}
	let bytes = 0;
	let raw = '';
	for await (const data of request) {
		bytes += data.length;
		raw += data;
		if (bytes > 2_000_000) {
			response.writeHead(413).end();
			return;
		}
	}
	const payload = JSON.parse(raw);
	const index = payload.messages.filter((message) => message.role === 'tool').length;
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	const chunk = (delta, finishReason = null) => {
		response.write(
			`data: ${JSON.stringify({
				id: `fixture-${index}`,
				object: 'chat.completion.chunk',
				created: 1,
				model: 'fixture',
				choices: [{ index: 0, delta, finish_reason: finishReason }],
			})}\n\n`
		);
	};
	if (index < paths.length) {
		chunk({
			role: 'assistant',
			tool_calls: [
				{
					index: 0,
					id: `read-${index}`,
					type: 'function',
					function: { name: 'read', arguments: JSON.stringify({ path: paths[index] }) },
				},
			],
		});
		chunk({}, 'tool_calls');
	} else {
		chunk({
			role: 'assistant',
			content: JSON.stringify(
				mode === 'blocking'
					? {
							findings: [blockingFinding],
							risk: 'critical',
							summary:
								'Controlled transport fixture: one fixed blocking finding exercises repeat-run publication only. It is not a model-quality result.',
						}
					: {
							findings: [],
							risk: 'none',
							summary:
								'Controlled transport fixture: the no-finding assessment exercises actual GitHub dismissal and approval publication only. It is not a model-quality result.',
						}
			),
		});
		chunk({}, 'stop');
	}
	response.write(
		`data: ${JSON.stringify({ id: `fixture-${index}`, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`
	);
	response.end('data: [DONE]\n\n');
});
server.listen(8317, '127.0.0.1');
process.on('SIGTERM', () => server.close());
