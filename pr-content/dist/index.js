"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const openai_1 = require("openai");
const prompts_1 = require("./prompts");
const contentUpdater_1 = require("./contentUpdater");
async function run() {
    try {
        const githubToken = core.getInput('github-token', { required: true });
        const openaiApiKey = core.getInput('openai-api-key', { required: true });
        const model = core.getInput('model') || 'gpt-4';
        const maxTokens = Number.parseInt(core.getInput('max-tokens') || '1000');
        const includeFileList = core.getInput('include-file-list') === 'true';
        const customInstructions = core.getInput('custom-instructions');
        const octokit = github.getOctokit(githubToken);
        const openai = new openai_1.OpenAI({ apiKey: openaiApiKey });
        const context = github.context;
        if (!context.payload.pull_request) {
            core.setFailed('This action can only be run on pull requests');
            return;
        }
        const { owner, repo } = context.repo;
        const pullNumber = context.payload.pull_request.number;
        // Get PR details and diff
        const [pr, files] = await Promise.all([
            octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber }),
            octokit.rest.pulls.listFiles({ owner, repo, pull_number: pullNumber }),
        ]);
        // Get diff for each file
        const diffs = await Promise.all(files.data.map(async (file) => {
            if (file.patch) {
                return {
                    filename: file.filename,
                    status: file.status,
                    patch: file.patch,
                };
            }
            return null;
        }));
        const validDiffs = diffs.filter((d) => d !== null);
        // Build prompts
        const systemPrompt = (0, prompts_1.createSystemPrompt)(customInstructions);
        const userPrompt = (0, prompts_1.buildUserPrompt)(pr.data.title, pr.data.body || '', validDiffs, includeFileList);
        // Generate content with AI
        const completion = await openai.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: maxTokens,
            temperature: 0.3,
        });
        const response = completion.choices[0]?.message?.content;
        if (!response) {
            core.setFailed('No response from OpenAI');
            return;
        }
        // Parse and update PR
        await (0, contentUpdater_1.updatePullRequestContent)(octokit, owner, repo, pullNumber, response);
        core.info('Successfully updated pull request content');
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed('An unknown error occurred');
        }
    }
}
run();
//# sourceMappingURL=index.js.map