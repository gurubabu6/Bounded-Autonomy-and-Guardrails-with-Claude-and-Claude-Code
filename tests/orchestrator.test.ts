import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator.js';
import {
  withRetry,
  withTimeout,
  ReviewError,
  ErrorCodes,
  formatError,
  isReviewError
} from '../src/utils/error-handler.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { mcpServersConfig } from '../src/config/mcp.config.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from '../src/agents/index.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('CodeReviewOrchestrator configuration', () => {
  it('initializes with default options', () => {
    expect(new CodeReviewOrchestrator()).toBeDefined();
  });

  it('accepts custom model, maxTurns, timeout and retries', () => {
    const orchestrator = new CodeReviewOrchestrator({
      model: 'claude-sonnet-4-5-20250929',
      maxTurns: 10,
      timeoutMs: 1000,
      maxRetries: 0
    });
    expect(orchestrator).toBeDefined();
  });

  it('fails fast with INVALID_CONFIG when no model is configured', async () => {
    vi.stubEnv('ANTHROPIC_MODEL', '');
    const orchestrator = new CodeReviewOrchestrator({ model: '' });
    await expect(orchestrator.reviewPullRequest('o', 'r', 1)).rejects.toMatchObject({
      code: ErrorCodes.INVALID_CONFIG
    });
  });
});

describe('MCP configuration', () => {
  it('configures GitHub and ESLint stdio servers run through npx', () => {
    expect(mcpServersConfig.github.type).toBe('stdio');
    expect(mcpServersConfig.github.command).toBe('npx');
    expect(mcpServersConfig.github.args).toContain('@modelcontextprotocol/server-github');
    expect(mcpServersConfig.eslint.type).toBe('stdio');
    expect(mcpServersConfig.eslint.command).toBe('npx');
  });
});

describe('Subagent definitions', () => {
  const agents = { codeQualityAnalyzer, testCoverageAnalyzer, refactoringSuggester };

  it('define three distinct agents that inherit the orchestrator model', () => {
    const descriptions = Object.values(agents).map((a) => a.description);
    expect(new Set(descriptions).size).toBe(3);
    for (const agent of Object.values(agents)) {
      expect(agent.model).toBe('inherit');
      expect(agent.prompt.length).toBeGreaterThan(100);
    }
  });

  it('give every agent the Skill tool and no write access', () => {
    for (const agent of Object.values(agents)) {
      expect(agent.tools).toContain('Skill');
      expect(agent.tools).not.toContain('Write');
      expect(agent.tools).not.toContain('Bash');
    }
  });
});

describe('withRetry', () => {
  it('returns the result without retrying when the first call succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return 'ok'; }, 3, 1);
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('succeeds after an initial failure', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('temporary');
      return 'success';
    }, 1, 1);
    expect(result).toBe('success');
    expect(calls).toBe(2);
  });

  it('makes maxRetries + 1 attempts then throws RETRY_EXHAUSTED with the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => { calls++; throw new Error('permanent'); }, 2, 1)
    ).rejects.toMatchObject({
      code: ErrorCodes.RETRY_EXHAUSTED,
      metadata: { lastError: 'permanent' }
    });
    expect(calls).toBe(3);
  });

  it('waits with exponential backoff between attempts', async () => {
    const delays: number[] = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    await expect(withRetry(async () => { throw new Error('x'); }, 3, 100)).rejects.toBeInstanceOf(ReviewError);
    spy.mockRestore();

    // base delays 100, 200, 400 plus 0-100ms jitter
    expect(delays).toHaveLength(3);
    [100, 200, 400].forEach((base, i) => {
      expect(delays[i]).toBeGreaterThanOrEqual(base);
      expect(delays[i]).toBeLessThan(base + 100);
    });
  });
});

describe('withTimeout', () => {
  it('rejects with AGENT_TIMEOUT when the operation is too slow', async () => {
    await expect(
      withTimeout(() => new Promise<string>((resolve) => setTimeout(() => resolve('late'), 50)), 5, 'Test timeout')
    ).rejects.toMatchObject({ code: ErrorCodes.AGENT_TIMEOUT, message: 'Test timeout' });
  });

  it('returns the value when the operation finishes in time', async () => {
    await expect(withTimeout(async () => 'fast', 100)).resolves.toBe('fast');
  });

  it('propagates errors thrown by the operation', async () => {
    await expect(withTimeout(async () => { throw new Error('boom'); }, 100)).rejects.toThrow('boom');
  });
});

describe('error helpers', () => {
  it('formatError and isReviewError handle ReviewError, Error and other values', () => {
    const err = new ReviewError('bad', ErrorCodes.VALIDATION_FAILED);
    expect(isReviewError(err)).toBe(true);
    expect(isReviewError(new Error('x'))).toBe(false);
    expect(formatError(err)).toBe('[VALIDATION_FAILED] bad');
    expect(formatError(new Error('plain'))).toBe('plain');
    expect(formatError('text')).toBe('text');
  });
});

describe('RateLimiter', () => {
  it('canProceed returns false once the request limit is reached', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxTokensPerMinute: 1000, maxConcurrent: 5 });
    expect(limiter.canProceed(10)).toBe(true);
    await limiter.acquire(10);
    limiter.release();
    expect(limiter.canProceed(10)).toBe(false);
  });

  it('canProceed returns false when the token budget would be exceeded', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 100, maxConcurrent: 5 });
    await limiter.acquire(90);
    limiter.release();
    expect(limiter.canProceed(20)).toBe(false);
    expect(limiter.canProceed(10)).toBe(true);
  });

  it('tracks requests in a sliding 60 second window', async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1, maxTokensPerMinute: 1000, maxConcurrent: 5 });
    await limiter.acquire(10);
    limiter.release();
    expect(limiter.canProceed(10)).toBe(false);
    expect(limiter.getStatus().requestsInWindow).toBe(1);

    vi.advanceTimersByTime(61_000);

    expect(limiter.canProceed(10)).toBe(true);
    expect(limiter.getStatus().requestsInWindow).toBe(0);
  });

  it('makes a second caller wait for a free slot when maxConcurrent is reached', async () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxTokensPerMinute: 10000, maxConcurrent: 1 });
    await limiter.acquire(10);

    let secondAcquired = false;
    const second = limiter.acquire(10).then(() => { secondAcquired = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondAcquired).toBe(false);

    limiter.release();
    await second;
    expect(secondAcquired).toBe(true);
    expect(limiter.getStatus().activeRequests).toBe(1);
  });
});

describe('Integration', () => {
  // Requires real API access; run manually: npm run dev -- octocat Hello-World 1
  // Verified output is stored in reports/octocat_Hello-World_1.*
  it.skip('reviews a real small PR (octocat/Hello-World #1)', async () => {
    const report = await new CodeReviewOrchestrator().reviewPullRequest('octocat', 'Hello-World', 1);
    expect(report.summary.totalFiles).toBeGreaterThan(0);
  });
});
