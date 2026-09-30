import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { refactoringSuggesterPrompt } from '../prompts/refactoring-suggester.prompt.js';

export const refactoringSuggester: AgentDefinition = {
  description:
    'Finds refactoring opportunities: design patterns, modern language features, extract-function candidates, and dead or redundant code.',
  model: 'inherit',
  prompt: refactoringSuggesterPrompt,
  tools: ['Read', 'Glob', 'Grep', 'Skill', 'mcp__github__get_file_contents']
};
