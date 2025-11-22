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
exports.updatePullRequestContent = updatePullRequestContent;
const core = __importStar(require("@actions/core"));
async function updatePullRequestContent(octokit, owner, repo, pullNumber, aiResponse) {
    try {
        // Parse AI response
        let update;
        try {
            update = JSON.parse(aiResponse);
        }
        catch (parseError) {
            // Try to extract JSON from response if it contains extra text
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                update = JSON.parse(jsonMatch[0]);
            }
            else {
                throw new Error('Failed to parse AI response as JSON');
            }
        }
        // Validate response
        if (!update.title || !update.description) {
            throw new Error('AI response missing required fields: title and description');
        }
        // Get current PR to compare
        const currentPR = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: pullNumber,
        });
        const hasChanges = currentPR.data.title !== update.title ||
            currentPR.data.body !== update.description;
        if (!hasChanges) {
            core.info('No changes needed - PR content is already optimal');
            return;
        }
        // Update PR
        await octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: pullNumber,
            title: update.title,
            body: update.description,
        });
        core.info(`Updated PR title: "${update.title}"`);
        core.info(`Updated PR description: ${update.description.substring(0, 100)}...`);
    }
    catch (error) {
        core.error(`Failed to update PR content: ${error}`);
        throw error;
    }
}
//# sourceMappingURL=contentUpdater.js.map