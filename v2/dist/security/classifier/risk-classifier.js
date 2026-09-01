/**
 * Deterministic Pre-LLM Risk Classifier.
 * Spec reference: §6.
 */
const SECURITY_DOMAIN_PATTERNS = [
    // Auth & Authorization & Access Control (Critical)
    {
        domain: 'authentication',
        pathRegex: /(?:auth|login|signin|signup|session|jwt|oauth|sso|token|credential|mfa|2fa)/i,
        contentRegex: /(?:jwt\.verify|jwt\.sign|bcrypt|argon2|passport|authenticate|session\.|createSession|verifyPassword)/i,
        weight: 4,
        reason: 'Changes in authentication / session management files',
    },
    {
        domain: 'authorization',
        pathRegex: /(?:authz|permission|role|rbac|abac|policy|acl|guard|canAccess|access[_-]?control)/i,
        contentRegex: /(?:hasPermission|requireRole|checkPermission|canAccess|isAuthorized|isAllowed|authorize)/i,
        weight: 4,
        reason: 'Changes in authorization / permission enforcement logic',
    },
    // Cryptography & Secrets
    {
        domain: 'cryptography',
        pathRegex: /(?:crypto|cipher|secret|key|vault|signature|encrypt|decrypt)/i,
        contentRegex: /(?:crypto\.createCipher|crypto\.createDecipher|AES|RSA|HMAC|privateKey|publicKey|crypto\.subtle)/i,
        weight: 3,
        reason: 'Cryptographic primitive or key handling changes',
    },
    // Payment & Billing
    {
        domain: 'payments',
        pathRegex: /(?:payment|billing|stripe|checkout|subscription|invoice|wallet|pricing)/i,
        contentRegex: /(?:stripe\.charges|stripe\.paymentIntents|refund|charge|creditCard)/i,
        weight: 3,
        reason: 'Payment / financial transaction processing changes',
    },
    // File Uploads & Parsers
    {
        domain: 'file-handling',
        pathRegex: /(?:upload|storage|s3|file[_-]?handler|multer|busboy|tar|zip|unzip|extractor)/i,
        contentRegex: /(?:multipart|upload\.single|createWriteStream|extract|unzip|fs\.writeFile)/i,
        weight: 3,
        reason: 'File upload, decompression, or filesystem writing logic',
    },
    // Serialization & Deserialization
    {
        domain: 'serialization',
        pathRegex: /(?:deserializ|unmarshal|parser|protobuf|msgpack|yaml[_-]?parser)/i,
        contentRegex: /(?:eval\(|pickle\.loads|yaml\.load\(|JSON\.parse\(|unserialize)/i,
        weight: 3,
        reason: 'Data parsing / deserialization boundary changes',
    },
    // Network & HTTP client (SSRF surfaces)
    {
        domain: 'network-boundary',
        pathRegex: /(?:proxy|gateway|fetcher|http[_-]?client|webhook|redirect|crawler)/i,
        contentRegex: /(?:axios\.|fetch\(|http\.request|needle|got\(|urllib|curl)/i,
        weight: 3,
        reason: 'Outbound HTTP client or reverse proxy changes (potential SSRF surface)',
    },
    // Database & SQL query construction (SQLi)
    {
        domain: 'database-security',
        pathRegex: /(?:repository|query[_-]?builder|dao|database|sql|migration)/i,
        contentRegex: /(?:raw\(|\$queryRaw|SELECT .* FROM|\.query\(["'`].*\$\{)/i,
        weight: 3,
        reason: 'Dynamic database query construction / raw SQL execution',
    },
    // Shell & Command execution (RCE)
    {
        domain: 'process-execution',
        pathRegex: /(?:exec|process|runner|subprocess|terminal|command)/i,
        contentRegex: /(?:child_process|exec\(|spawn\(|execSync|system\(|shell_exec|execFile)/i,
        weight: 4,
        reason: 'Shell / OS process execution changes (potential command injection surface)',
    },
    // CI/CD & GitHub Actions Workflows
    {
        domain: 'cicd-security',
        pathRegex: /(?:\.github\/workflows\/.*\.ya?ml|Dockerfile|docker-compose.*\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile)/i,
        contentRegex: /(?:pull_request_target|permissions:|GITHUB_TOKEN|secrets\.|eval|bash -c)/i,
        weight: 4,
        reason: 'CI/CD pipeline, GitHub Action workflow, or container build changes',
    },
    // Infrastructure as Code / Kubernetes / Terraform
    {
        domain: 'cloud-infrastructure',
        pathRegex: /(?:terraform|k8s|helm|cloudformation|pulumi|\.tf$|values\.ya?ml)/i,
        weight: 3,
        reason: 'Infrastructure as Code / deployment topology changes',
    },
    // Dependencies & Lockfiles (Supply Chain)
    {
        domain: 'supply-chain',
        pathRegex: /(?:package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|Pipfile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle)/i,
        weight: 2,
        reason: 'Dependency manifest or package lockfile modifications',
    },
    // AI / LLM / Agent permissions / Tool execution
    {
        domain: 'ai-security',
        pathRegex: /(?:agent|mcp|tool|prompt|openai|anthropic|langchain|llm)/i,
        contentRegex: /(?:systemPrompt|temperature|tool_choice|executeTool|callTool|modelProvider)/i,
        weight: 3,
        reason: 'AI / LLM agent tools, prompts, or MCP integrations',
    },
];
/**
 * Classifies PR risk level and domain surfaces without calling an LLM.
 */
export function classifyPrRisk(changedFiles) {
    const matchedDomains = new Set();
    const reasons = new Set();
    let maxWeight = 1;
    const flaggedFiles = [];
    for (const file of changedFiles) {
        let fileMatched = false;
        const filename = file.filename;
        const patch = file.patch || '';
        for (const rule of SECURITY_DOMAIN_PATTERNS) {
            const pathHit = rule.pathRegex.test(filename);
            const contentHit = rule.contentRegex
                ? rule.contentRegex.test(patch)
                : false;
            if (pathHit || contentHit) {
                matchedDomains.add(rule.domain);
                reasons.add(rule.reason);
                fileMatched = true;
                if (rule.weight > maxWeight) {
                    maxWeight = rule.weight;
                }
            }
        }
        if (fileMatched) {
            flaggedFiles.push(filename);
        }
    }
    let level = 'low';
    if (maxWeight >= 4) {
        level = 'critical_surface';
    }
    else if (maxWeight === 3) {
        level = 'high';
    }
    else if (maxWeight === 2 || matchedDomains.size > 0) {
        level = 'medium';
    }
    return {
        level,
        reasons: Array.from(reasons),
        domains: Array.from(matchedDomains),
        changedFiles: flaggedFiles,
    };
}
//# sourceMappingURL=risk-classifier.js.map