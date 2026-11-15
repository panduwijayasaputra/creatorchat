import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../src/client.js';
import { parseDatabaseUrl } from '../src/testing/safe-database.js';
import { AdminAccountError, createOrResetAdmin } from './admin-account.js';

const USAGE = `Usage: pnpm admin:create --username <name> [--password-env <VAR>] [--reset-password]

  --username        3-32 characters: a-z, 0-9, ".", "_", "-"
  --password-env    NAME of an environment variable that holds the password (min 12 characters).
                    Omit to generate a password, which is shown once.
  --reset-password  Replace the password of an existing admin and sign it out everywhere.

The password is never accepted as a command-line argument (shell history).`;

async function main(): Promise<void> {
  const rootEnv = resolve(import.meta.dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      'password-env': { type: 'string' },
      'reset-password': { type: 'boolean', default: false },
      'allow-test': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (!values.username) throw new AdminAccountError(`--username is required.\n\n${USAGE}`);

  if (process.env.NODE_ENV === 'production') {
    throw new AdminAccountError('Refusing to run: NODE_ENV is production.');
  }
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new AdminAccountError('DATABASE_URL is not set. Copy .env.example to .env first.');
  const target = parseDatabaseUrl(url);
  if (target.database.endsWith('_test') && !values['allow-test']) {
    throw new AdminAccountError(
      `Refusing to touch test database "${target.database}" (use --allow-test to override).`,
    );
  }

  let password: string | undefined;
  if (values['password-env']) {
    password = process.env[values['password-env']];
    if (!password) {
      throw new AdminAccountError(
        `Environment variable ${values['password-env']} is empty or unset.`,
      );
    }
  }

  // Host and database name only; credentials are never printed.
  console.log(`Using database "${target.database}" on ${target.host}:${target.port} ...`);
  const prisma = createPrismaClient(url);
  try {
    const result = await createOrResetAdmin(prisma, {
      username: values.username,
      password,
      resetPassword: values['reset-password'] ?? false,
    });
    console.log(
      `Admin "${result.username}" ${result.action === 'created' ? 'created' : 'password reset'}.`,
    );
    if (result.generatedPassword) {
      console.log('');
      console.log(`  Generated password: ${result.generatedPassword}`);
      console.log('  Store it now. It is shown only once and cannot be recovered.');
      console.log('');
    } else {
      console.log('The password you supplied was used. It is not stored anywhere in plain text.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof AdminAccountError) console.error(error.message);
  else if (error instanceof Error && error.name === 'TypeError')
    console.error(`${error.message}\n\n${USAGE}`);
  else console.error(error instanceof Error ? error.message : 'Admin command failed');
  process.exit(1);
});
