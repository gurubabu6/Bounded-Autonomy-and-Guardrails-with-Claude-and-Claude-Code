import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { codeQualityAnalyzerPrompt } from '../prompts/code-quality-analyzer.prompt.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Analyzes pull request code for security vulnerabilities, performance problems, maintainability issues, bug risks and best-practice violations.',
  model: 'inherit',
  prompt: codeQualityAnalyzerPrompt,
  tools: ['Read', 'Glob', 'Grep', 'Skill', 'mcp__github__get_file_contents']
};
