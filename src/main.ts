import 'dotenv/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';


/**
 * Usage: npm run dev -- <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  const [owner, repo, prStr] = process.argv.slice(2);

  // 1. Validate command-line arguments
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev -- <owner> <repo> <pr-number>');
    console.error('Example: npm run dev -- octocat Hello-World 1');
    process.exit(1);
  }

  const prNumber = /^\d+$/.test(prStr) ? parseInt(prStr, 10) : NaN;
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error(`Invalid pull request number "${prStr}". It must be a positive integer.`);
    process.exit(1);
  }

  // 2. Validate authentication (Anthropic API OR AWS Bedrock)
  const hasAnthropicAuth = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsAuth =
    Boolean(process.env.AWS_ACCESS_KEY_ID) && Boolean(process.env.AWS_SECRET_ACCESS_KEY);

  if (hasAwsAuth && !process.env.AWS_REGION) {
    console.error('AWS credentials are set but AWS_REGION is missing. Add AWS_REGION to your environment.');
    process.exit(1);
  }
  if (!hasAnthropicAuth && !hasAwsAuth) {
    console.error(
      'No authentication configured. Set either:\n' +
        '  1. ANTHROPIC_API_KEY (Anthropic API), or\n' +
        '  2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION (AWS Bedrock)'
    );
    process.exit(1);
  }
  console.log(hasAwsAuth ? '🔐 Using AWS Bedrock authentication' : '🔐 Using Anthropic API authentication');

  // 3. Validate model
  const model = process.env.ANTHROPIC_MODEL;
  if (!model) {
    console.error(
      'ANTHROPIC_MODEL is required. Add it to your .env file, for example:\n' +
        '  Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
        '  AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    );
    process.exit(1);
  }

  if (!process.env.GITHUB_TOKEN) {
    console.warn('⚠️  GITHUB_TOKEN is not set. You may hit GitHub rate limits.');
  }

  console.log(`�� Model: ${model}`);
  console.log(`🔍 Reviewing ${owner}/${repo}#${prNumber} ...`);

  try {
    // 4. Run the review
    const orchestrator = new CodeReviewOrchestrator({ model });
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);
    console.log('✅ Review completed.');

    // 5. Generate and save the three report formats
    const generator = new ReportGenerator();
    const reportsDir = path.resolve(process.cwd(), 'reports');
    await fs.mkdir(reportsDir, { recursive: true });

    const base = `${owner}_${repo}_${prNumber}`;
    const jsonPath = path.join(reportsDir, `${base}.json`);
    const mdPath = path.join(reportsDir, `${base}.md`);
    const htmlPath = path.join(reportsDir, `${base}.html`);

    await fs.writeFile(jsonPath, generator.generateJSONReport(report), 'utf-8');
    await fs.writeFile(mdPath, generator.generateMarkdownReport(report), 'utf-8');
    await fs.writeFile(htmlPath, generator.generateHTMLReport(report), 'utf-8');

    console.log('📊 Reports saved:');
    console.log(`   JSON:     ${jsonPath}`);
    console.log(`   Markdown: ${mdPath}`);
    console.log(`   HTML:     ${htmlPath}`);
    console.log(`   Overall score: ${report.summary.overallScore}/100`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Review failed: ${message}`);
    console.error('Tip: check GITHUB_TOKEN, ANTHROPIC_MODEL, and that the PR exists.');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
