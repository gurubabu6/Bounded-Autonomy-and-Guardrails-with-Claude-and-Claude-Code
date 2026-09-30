import { query } from '@anthropic-ai/claude-agent-sdk';
import { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester } from './agents/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import { orchestratorPrompt } from './prompts/orchestrator.prompt.js';
import { ReviewReport, ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types.js';
import { withRetry, withTimeout, ReviewError, ErrorCodes, formatError } from './utils/error-handler.js';
import { globalRateLimiter } from './utils/rate-limiter.js';
import { logger } from './utils/logger.js';

export interface OrchestratorOptions {
  model?: string;
  maxTurns?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

/**
 * Main Code Review Orchestrator.
 * Fetches PR data via GitHub MCP, spawns three subagents with the Task tool,
 * and validates the aggregated result against ReviewReportSchema.
 */
export class CodeReviewOrchestrator {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model || process.env.ANTHROPIC_MODEL || '';
    this.maxTurns = options.maxTurns ?? 40;
    this.timeoutMs = options.timeoutMs ?? 10 * 60 * 1000; // 10 minutes
    this.maxRetries = options.maxRetries ?? 1;
  }

  async reviewPullRequest(owner: string, repo: string, prNumber: number): Promise<ReviewReport> {
    if (!this.model) {
      throw new ReviewError('ANTHROPIC_MODEL is not set', ErrorCodes.INVALID_CONFIG);
    }

    const startTime = Date.now();
    logger.info('Starting code review', { owner, repo, prNumber });

    try {
      // retry (backoff + jitter) > rate limit > timeout > SDK call
      const raw = await withRetry(
        async () => {
          await globalRateLimiter.acquire(20000);
          try {
            return await withTimeout(
              () => this.runReview(owner, repo, prNumber),
              this.timeoutMs,
              `Review of ${owner}/${repo}#${prNumber} timed out`
            );
          } finally {
            globalRateLimiter.release();
          }
        },
        this.maxRetries,
        2000
      );

      return this.finalize(raw, owner, repo, prNumber, Date.now() - startTime);
    } catch (error) {
      // Surface the real cause instead of a generic "retry exhausted"
      const cause =
        error instanceof ReviewError && error.metadata?.lastError
          ? String(error.metadata.lastError)
          : formatError(error);
      throw new ReviewError(
        `Failed to review ${owner}/${repo}#${prNumber}: ${cause}`,
        ErrorCodes.AGENT_FAILED
      );
    }
  }

  /** One SDK query; returns the raw structured_output. */
  private async runReview(owner: string, repo: string, prNumber: number): Promise<unknown> {
    for await (const message of query({
      prompt: orchestratorPrompt(owner, repo, prNumber),
      options: {
        model: this.model,
        maxTurns: this.maxTurns,
        cwd: process.env.PROJECT_ROOT || process.cwd(),
        settingSources: ['project'], // lets .claude/skills load
        allowedTools: [
          'Task',
          'Skill',
          'Read',
          'Glob',
          'Grep',
          'mcp__github__get_pull_request',
          'mcp__github__get_pull_request_files',
          'mcp__github__get_file_contents',
          'mcp__eslint__lint-files'
        ],
        disallowedTools: ['Bash', 'Write', 'Edit'], // guardrail: review is read-only
        permissionMode: 'acceptEdits',
        mcpServers: mcpServersConfig,
        agents: {
          'code-quality-analyzer': codeQualityAnalyzer,
          'test-coverage-analyzer': testCoverageAnalyzer,
          'refactoring-suggester': refactoringSuggester
        },
        outputFormat: { type: 'json_schema', schema: ReviewReportJSONSchema }
      }
    })) {
      // Log each subagent spawned by the Task tool
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use' && block.name === 'Task') {
            const input = block.input as { subagent_type?: string };
            logger.info('Subagent invoked', { subagent: input.subagent_type });
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success' && message.structured_output) {
          return message.structured_output;
        }
        throw new ReviewError(
          `Agent finished without structured output (${message.subtype})`,
          ErrorCodes.STRUCTURED_OUTPUT_FAILED
        );
      }
    }

    throw new ReviewError('The SDK never produced a result', ErrorCodes.STRUCTURED_OUTPUT_FAILED);
  }

  /** Validate with Zod, then compute summary and metadata from the real findings. */
  private finalize(raw: unknown, owner: string, repo: string, prNumber: number, duration: number): ReviewReport {
    const parsed = ReviewReportSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ReviewError(
        'Report failed schema validation: ' +
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        ErrorCodes.VALIDATION_FAILED
      );
    }

    const report = parsed.data;
    const files = report.fileReviews;
    const scores = files.map((f) => f.codeQuality.overallScore);

    report.pullRequest = { owner, repo, number: prNumber };
    report.summary = {
      totalFiles: files.length,
      overallScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      criticalIssues: files.reduce(
        (n, f) => n + f.codeQuality.issues.filter((i) => i.severity === 'critical').length, 0),
      highPriorityTests: files.reduce(
        (n, f) => n + f.testCoverage.untestedPaths.filter(
          (p) => p.priority === 'critical' || p.priority === 'high').length, 0),
      refactoringOpportunities: files.reduce((n, f) => n + f.refactorings.suggestions.length, 0)
    };
    report.metadata = {
      analyzedAt: new Date().toISOString(),
      duration,
      agentVersions: {
        'code-quality-analyzer': '1.0.0',
        'test-coverage-analyzer': '1.0.0',
        'refactoring-suggester': '1.0.0'
      }
    };
    return report;
  }
}
