import crypto from 'crypto';

export interface ReviewComment {
        path: string;
        line: number;
        body: string;
        id: string;
}

interface StructuredInlineComment {
        line: number;
        title?: string;
        comment?: string;
        recommendation?: string;
        severity?: string;
        rule_id?: string;
}

interface StructuredReviewResponse {
	file_overview?: string;
	summary_points?: string[];
	risks?: string[];
	positive_insights?: string[];
	inline_comments?: StructuredInlineComment[];
}

export interface ParsedReviewData {
        summary: string;
        comments: ReviewComment[];
}

const SEVERITY_ICON_MAP: Record<string, string> = {
        info: 'ℹ️',
        low: '✅',
        medium: '⚠️',
        high: '🔥',
};

const ISSUE_DOC_URL =
        'https://github.com/niko0xdev/action-code-review/tree/main/pr-review#severity-levels';

export function filterCommentsBySeverity(
	comments: ReviewComment[],
	minSeverity: string
): ReviewComment[] {
	// Define severity levels in order of importance
	const severityLevels = {
		info: 0,
		low: 1,
		medium: 2,
		high: 3,
	};

	// Normalize the minimum severity
	const normalizedMinSeverity = minSeverity.toLowerCase();
	const minLevel = severityLevels[normalizedMinSeverity as keyof typeof severityLevels] || 0;

	// Filter comments based on severity
	return comments.filter((comment) => {
		// Extract severity from comment body
		const severityMatch = comment.body.match(/_Severity:_\s*(\w+)/i);
		if (!severityMatch) {
			// If no severity is specified, include it if min severity is info
			return minLevel <= 0;
		}

		const commentSeverity = severityMatch[1].toLowerCase();
		const commentLevel = severityLevels[commentSeverity as keyof typeof severityLevels] || 0;

		return commentLevel >= minLevel;
	});
}

export function parseReviewForComments(
	reviewText: string,
	filename: string
): ReviewComment[] {
	const comments: ReviewComment[] = [];
	const lines = reviewText.split('\n');

	let currentComment = '';
	let targetLine: number | null = null;

	for (const line of lines) {
		// Look for line number patterns like "Line 42:" or "L42:"
		const lineMatch = line.match(/(?:Line|L)\s*(\d+):?/);

		if (lineMatch) {
			// If we have a pending comment, save it
			if (currentComment && targetLine) {
                                comments.push({
                                        path: filename,
                                        line: targetLine,
                                        body: currentComment.trim(),
                                        id: buildCommentId({
                                                path: filename,
                                                line: targetLine,
                                                body: currentComment,
                                        }),
                                });
                        }

			// Start new comment
			targetLine = Number.parseInt(lineMatch[1]);
			currentComment = line.replace(/(?:Line|L)\s*\d+:?/, '').trim();
		} else if (targetLine) {
			// Continue collecting comment text
			currentComment += `\n${line}`;
		}
	}

	// Don't forget the last comment
	if (currentComment && targetLine) {
                        comments.push({
                                path: filename,
                                line: targetLine,
                                body: currentComment.trim(),
                                id: buildCommentId({
                                        path: filename,
                                        line: targetLine,
                                        body: currentComment,
                                }),
                        });
                }

	// If no line-specific comments were found, create a general comment
	if (comments.length === 0 && reviewText.trim()) {
		comments.push({
                        path: filename,
                        line: 1, // Default to first line
                        body: reviewText.trim(),
                        id: buildCommentId({
                                path: filename,
                                line: 1,
                                body: reviewText,
                        }),
                });
        }

	return comments;
}

export function parseReviewResponse(
	reviewText: string,
	filename: string
): ParsedReviewData {
	const structured = tryParseStructuredReview(reviewText);
	if (structured) {
		const summary = buildStructuredSummary(structured) || reviewText.trim();
		const comments = convertStructuredComments(
			structured.inline_comments,
			filename
		);
		return {
			summary,
			comments:
				comments.length > 0
					? comments
					: parseReviewForComments(reviewText, filename),
		};
	}

	return {
		summary: reviewText.trim(),
		comments: parseReviewForComments(reviewText, filename),
	};
}

function tryParseStructuredReview(
	reviewText: string
): StructuredReviewResponse | null {
	if (!reviewText) {
		return null;
	}

	const trimmed = reviewText.trim();
	const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/i);
	const possibleJson = fencedMatch ? fencedMatch[1].trim() : trimmed;

	if (!possibleJson.startsWith('{')) {
		return null;
	}

	try {
		const parsed = JSON.parse(possibleJson);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as StructuredReviewResponse;
		}
	} catch {
		// Ignore parse errors and fall back to text parsing
	}

	return null;
}

function buildStructuredSummary(structured: StructuredReviewResponse): string {
	const sections: string[] = [];

	if (structured.file_overview?.trim()) {
		sections.push(structured.file_overview.trim());
	}

	if (structured.summary_points?.length) {
		const bullets = structured.summary_points
			.filter((point) => typeof point === 'string' && point.trim())
			.map((point) => `- ${point.trim()}`);
		if (bullets.length) {
			sections.push(bullets.join('\n'));
		}
	}

	if (structured.positive_insights?.length) {
		const positives = structured.positive_insights
			.filter((point) => typeof point === 'string' && point.trim())
			.map((point) => `- ${point.trim()}`);
		if (positives.length) {
			sections.push(`**Positive notes**\n${positives.join('\n')}`);
		}
	}

	if (structured.risks?.length) {
		const risks = structured.risks
			.filter((risk) => typeof risk === 'string' && risk.trim())
			.map((risk) => `- ${risk.trim()}`);
		if (risks.length) {
			sections.push(`**Risks & regressions**\n${risks.join('\n')}`);
		}
	}

	return sections.join('\n\n').trim();
}

function convertStructuredComments(
        inlineComments: StructuredInlineComment[] | undefined,
        filename: string
): ReviewComment[] {
        if (!Array.isArray(inlineComments)) {
		return [];
	}

	return inlineComments
		.filter(
			(comment) =>
				typeof comment.line === 'number' && comment.line > 0 && comment.comment
		)
		.map((comment) => {
			const parts: string[] = [];
			const title = comment.title?.trim();
                        const explanation = comment.comment?.trim();
                        const recommendation = comment.recommendation?.trim();
                        const severity = comment.severity?.trim();

			if (title) {
				parts.push(`**${title}**`);
			}

			if (explanation) {
				parts.push(explanation);
			}

			if (recommendation) {
				parts.push(`_Recommendation:_ ${recommendation}`);
			}

                        if (severity) {
                                parts.push(formatSeverity(severity));
                        }

                        return {
                                path: filename,
                                line: comment.line,
                                body: parts.join('\n\n').trim(),
                                id: buildCommentId({
                                        path: filename,
                                        line: comment.line,
                                        body: parts.join('\n\n'),
                                        ruleId: comment.rule_id,
                                }),
                        };
                })
                .filter((comment) => Boolean(comment.body));
}

function formatSeverity(severity: string): string {
        const normalized = severity.toLowerCase();
        const icon = SEVERITY_ICON_MAP[normalized];
        const prefix = icon ? `${icon} ` : '';

        return `_Severity:_ ${prefix}${normalized} — see ${ISSUE_DOC_URL}`;
}

function buildCommentId(params: {
        path: string;
        line: number;
        body: string;
        ruleId?: string;
}): string {
        const hash = crypto.createHash('sha256');
        hash.update([
                params.path,
                params.line.toString(),
                params.body.trim(),
                params.ruleId?.trim() ?? '',
        ].join('|'));

        return hash.digest('hex').slice(0, 12);
}
