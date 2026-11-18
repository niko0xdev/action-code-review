import { createServer } from 'node:http';

// Canary-only controlled transport. Never use this as a source assessment.
const paths = ['src/data/tenant-store.ts', 'tests/canary/tenant-store.test.ts'];
let requestCount = 0;
const server = createServer(async (request, response) => {
	if (request.url === '/health') {
		response.writeHead(200).end('ready');
		return;
	}
	if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
		response.writeHead(404).end();
		return;
	}
	let bytes = 0;
	for await (const data of request) {
		bytes += data.length;
		if (bytes > 1_000_000) {
			response.writeHead(413).end();
			return;
		}
	}
	const index = requestCount++;
	response.writeHead(200, { 'Content-Type': 'text/event-stream' });
	const chunk = (delta, finishReason = null) => {
		response.write(`data: ${JSON.stringify({
			id: `fixture-${index}`,
			object: 'chat.completion.chunk',
			created: 1,
			model: 'fixture',
			choices: [{ index: 0, delta, finish_reason: finishReason }],
		})}\n\n`);
	};
	if (index < paths.length) {
		chunk({ role: 'assistant', tool_calls: [{
			index: 0, id: `read-${index}`, type: 'function',
			function: { name: 'read', arguments: JSON.stringify({ path: paths[index] }) },
		}] });
		chunk({}, 'tool_calls');
	} else {
		chunk({ role: 'assistant', content: JSON.stringify({
			findings: [], risk: 'none',
			summary: 'Controlled transport fixture: the no-finding assessment exercises actual GitHub approval publication only. It is not a model-quality result.',
		}) });
		chunk({}, 'stop');
	}
	response.write(`data: ${JSON.stringify({ id: `fixture-${index}`, choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } })}\n\n`);
	response.end('data: [DONE]\n\n');
});
server.listen(8317, '127.0.0.1');
process.on('SIGTERM', () => server.close());
