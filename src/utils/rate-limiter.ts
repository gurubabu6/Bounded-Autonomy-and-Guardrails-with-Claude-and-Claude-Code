/**
 * Rate Limiter for API requests and token usage.
 * Token bucket algorithm with a sliding 60-second window.
 */

export interface RateLimiterConfig {
  /** Maximum requests per minute */
  maxRequestsPerMinute: number;
  /** Maximum tokens per minute */
  maxTokensPerMinute: number;
  /** Maximum concurrent requests */
  maxConcurrent: number;
}

export const DEFAULT_RATE_LIMITS: RateLimiterConfig = {
  maxRequestsPerMinute: 50,
  maxTokensPerMinute: 100000,
  maxConcurrent: 5
};

interface RequestRecord {
  timestamp: number;
  tokens: number;
}

const WINDOW_MS = 60_000;

export class RateLimiter {
  private config: RateLimiterConfig;
  private requestHistory: RequestRecord[] = [];
  private activeRequests = 0;
  private waitQueue: Array<() => void> = [];

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMITS, ...config };
  }

  /**
   * Main entry point: wait for a concurrency slot, then for the rate limit,
   * then record the request.
   */
  async acquire(estimatedTokens: number = 1000): Promise<void> {
    while (this.activeRequests >= this.config.maxConcurrent) {
      await this.waitForSlot();
    }
    await this.waitForRateLimit(estimatedTokens);

    this.activeRequests++;
    this.requestHistory.push({ timestamp: Date.now(), tokens: estimatedTokens });
  }

  /**
   * Release a slot after the request completes; optionally correct the token count.
   */
  release(actualTokens?: number): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);

    if (actualTokens !== undefined && this.requestHistory.length > 0) {
      const last = this.requestHistory[this.requestHistory.length - 1];
      if (last) last.tokens = actualTokens;
    }

    // Wake one waiting caller
    const next = this.waitQueue.shift();
    if (next) next();
  }

  getStatus(): {
    activeRequests: number;
    requestsInWindow: number;
    tokensInWindow: number;
    availableRequests: number;
    availableTokens: number;
  } {
    this.pruneOldRecords();
    const requestsInWindow = this.requestHistory.length;
    const tokensInWindow = this.requestHistory.reduce((sum, r) => sum + r.tokens, 0);

    return {
      activeRequests: this.activeRequests,
      requestsInWindow,
      tokensInWindow,
      availableRequests: Math.max(0, this.config.maxRequestsPerMinute - requestsInWindow),
      availableTokens: Math.max(0, this.config.maxTokensPerMinute - tokensInWindow)
    };
  }

  /**
   * True only if concurrency, requests/minute AND tokens/minute all allow it.
   */
  canProceed(estimatedTokens: number = 1000): boolean {
    this.pruneOldRecords();
    const tokensInWindow = this.requestHistory.reduce((sum, r) => sum + r.tokens, 0);

    return (
      this.activeRequests < this.config.maxConcurrent &&
      this.requestHistory.length < this.config.maxRequestsPerMinute &&
      tokensInWindow + estimatedTokens <= this.config.maxTokensPerMinute
    );
  }

  /**
   * Park the caller until release() resolves the promise.
   */
  private waitForSlot(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  /**
   * Sleep until the oldest record leaves the 60s window, re-checking each time.
   */
  private async waitForRateLimit(estimatedTokens: number): Promise<void> {
    while (!this.canProceed(estimatedTokens)) {
      const oldest = this.requestHistory[0];
      if (!oldest) break; // window empty: only concurrency could block, handled in acquire()

      const waitMs = Math.min(5000, Math.max(100, oldest.timestamp + WINDOW_MS - Date.now() + 100));
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Drop records older than 60 seconds (the sliding window).
   */
  private pruneOldRecords(): void {
    const cutoff = Date.now() - WINDOW_MS;
    this.requestHistory = this.requestHistory.filter((r) => r.timestamp > cutoff);
  }
}

/**
 * Wrap an async function with rate limiting.
 */
export async function withRateLimit<T>(
  rateLimiter: RateLimiter,
  fn: () => Promise<T>,
  estimatedTokens: number = 1000
): Promise<T> {
  await rateLimiter.acquire(estimatedTokens);
  try {
    return await fn();
  } finally {
    rateLimiter.release();
  }
}

/**
 * Shared limiter instance for the whole app
 */
export const globalRateLimiter = new RateLimiter();
