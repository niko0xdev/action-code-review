import { normalizeBaseUrl } from '../llm/config.js';
export function resolveEngineConfig(input) {
    const apiKey = input.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('Missing API key: provide the openai-api-key input or set OPENAI_API_KEY.');
    }
    const model = input.model || process.env.OPENAI_API_MODEL;
    if (!model) {
        throw new Error('Missing model id: provide the openai-model input or set OPENAI_API_MODEL.');
    }
    const rawBaseUrl = input.baseUrl || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
    return {
        provider: 'openai',
        apiKey,
        baseUrl: normalizeBaseUrl(rawBaseUrl),
        model,
    };
}
//# sourceMappingURL=engine-config.js.map