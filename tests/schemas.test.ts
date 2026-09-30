import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CodeQualityResultSchema,
  TestCoverageResultSchema,
  RefactoringSuggestionSchema,
  CodeQualityResultJSONSchema
} from '../src/types/analysis-results.js';
import { ReviewReportSchema, ReviewReportJSONSchema } from '../src/types/report-types.js';

const codeQuality = {
  file: 'src/a.ts',
  issues: [
    { line: 3, severity: 'high', category: 'security', description: 'XSS via innerHTML', suggestion: 'Escape user input' }
  ],
  overallScore: 70,
  summary: 'One security issue'
};

const testCoverage = {
  file: 'src/a.ts',
  hasTests: false,
  testFiles: [],
  untestedPaths: [
    { type: 'function', location: 'f() line 3', priority: 'high', reasoning: 'Core logic', suggestedTest: "expect(f('')).toEqual([])" }
  ],
  coverageEstimate: 0,
  summary: 'No tests'
};

const refactoring = {
  file: 'src/a.ts',
  suggestions: [
    { type: 'modernize', location: 'f() line 3', impact: 'low', description: 'Use const', before: 'var a = 1', after: 'const a = 1', benefits: 'Block scoping' }
  ],
  summary: 'Minor modernization'
};

describe('analysis schemas: valid data', () => {
  it('accepts valid code quality, test coverage and refactoring results', () => {
    expect(() => CodeQualityResultSchema.parse(codeQuality)).not.toThrow();
    expect(() => TestCoverageResultSchema.parse(testCoverage)).not.toThrow();
    expect(() => RefactoringSuggestionSchema.parse(refactoring)).not.toThrow();
  });
});

describe('analysis schemas: invalid data', () => {
  it('rejects wrong types', () => {
    expect(() => CodeQualityResultSchema.parse({ ...codeQuality, overallScore: 'high' })).toThrow(ZodError);
  });

  it('rejects invalid enum values', () => {
    const badSeverity = { ...codeQuality, issues: [{ ...codeQuality.issues[0], severity: 'urgent' }] };
    expect(() => CodeQualityResultSchema.parse(badSeverity)).toThrow(ZodError);
    const badType = { ...refactoring, suggestions: [{ ...refactoring.suggestions[0], type: 'rewrite' }] };
    expect(() => RefactoringSuggestionSchema.parse(badType)).toThrow(ZodError);
  });

  it('rejects missing required fields', () => {
    expect(() => TestCoverageResultSchema.parse({ file: 'x' })).toThrow(ZodError);
  });
});

describe('analysis schemas: edge cases', () => {
  it('accepts empty arrays', () => {
    expect(CodeQualityResultSchema.safeParse({ ...codeQuality, issues: [] }).success).toBe(true);
    expect(TestCoverageResultSchema.safeParse({ ...testCoverage, untestedPaths: [] }).success).toBe(true);
    expect(RefactoringSuggestionSchema.safeParse({ ...refactoring, suggestions: [] }).success).toBe(true);
  });

  it('accepts score boundaries 0 and 100 and rejects values outside', () => {
    expect(CodeQualityResultSchema.safeParse({ ...codeQuality, overallScore: 0 }).success).toBe(true);
    expect(CodeQualityResultSchema.safeParse({ ...codeQuality, overallScore: 100 }).success).toBe(true);
    expect(CodeQualityResultSchema.safeParse({ ...codeQuality, overallScore: 101 }).success).toBe(false);
    expect(CodeQualityResultSchema.safeParse({ ...codeQuality, overallScore: -1 }).success).toBe(false);
    expect(TestCoverageResultSchema.safeParse({ ...testCoverage, coverageEstimate: 101 }).success).toBe(false);
  });
});

describe('ReviewReportSchema', () => {
  const report = {
    pullRequest: { owner: 'o', repo: 'r', number: 1 },
    fileReviews: [{ file: 'src/a.ts', codeQuality, testCoverage, refactorings: refactoring }],
    summary: { totalFiles: 1, overallScore: 70, criticalIssues: 0, highPriorityTests: 1, refactoringOpportunities: 1 },
    recommendations: [{ priority: 'high', category: 'security', description: 'Escape input', files: ['src/a.ts'] }],
    metadata: { analyzedAt: new Date().toISOString(), duration: 1, agentVersions: { 'code-quality-analyzer': '1.0.0' } }
  };

  it('accepts a complete report', () => {
    expect(ReviewReportSchema.safeParse(report).success).toBe(true);
  });

  it('accepts a report with no file reviews', () => {
    expect(ReviewReportSchema.safeParse({ ...report, fileReviews: [], recommendations: [] }).success).toBe(true);
  });

  it('rejects an invalid recommendation priority', () => {
    const bad = { ...report, recommendations: [{ ...report.recommendations[0], priority: 'urgent' }] };
    expect(ReviewReportSchema.safeParse(bad).success).toBe(false);
  });
});

describe('JSON schema export', () => {
  it('exports an object schema with the required top-level properties', () => {
    const schema = ReviewReportJSONSchema as { type?: string; properties?: Record<string, unknown>; required?: string[] };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(['pullRequest', 'fileReviews', 'summary', 'recommendations', 'metadata'])
    );
  });

  it('marks code quality fields as required', () => {
    const schema = CodeQualityResultJSONSchema as { required?: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['file', 'issues', 'overallScore', 'summary']));
  });
});
