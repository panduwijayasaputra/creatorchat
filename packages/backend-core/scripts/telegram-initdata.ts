import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInitData, InitDataToolError, USAGE } from './initdata-tool.js';

function main(): void {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const { initData, devUrl } = createInitData(argv, process.env);
  console.log('initData (signed with the local bot token; valid for the configured max age):\n');
  console.log(initData);
  console.log('\nOpen this in a browser while `pnpm dev` runs (development only):\n');
  console.log(devUrl);
}

try {
  main();
} catch (error) {
  if (error instanceof InitDataToolError) {
    console.error(error.message);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(`\n${USAGE}`);
  }
  process.exitCode = 1;
}
