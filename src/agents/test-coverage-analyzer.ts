import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { testCoverageAnalyzerPrompt } from '../prompts/test-coverage-analyzer.prompt.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Evaluates test completeness for changed code: finds untested functions and edge cases, estimates coverage, and suggests specific tests.',
  model: 'inherit',
  prompt: testCoverageAnalyzerPrompt,
  tools: ['Read', 'Glob', 'Grep', 'Skill', 'mcp__github__get_file_contents']
};
