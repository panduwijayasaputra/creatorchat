import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { runWebhookCommand, USAGE, WebhookToolError } from './webhook-tool.js';

async function main(): Promise<void> {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  await runWebhookCommand(argv, process.env);
}

main().catch((error: unknown) => {
  if (error instanceof WebhookToolError) {
    console.error(error.message);
  } else {
    // Argument errors only; request failures are wrapped above so no URL or token can appear.
    console.error(error instanceof Error ? error.message : 'Failed.');
    console.error(`\n${USAGE}`);
  }
  process.exitCode = 1;
});
