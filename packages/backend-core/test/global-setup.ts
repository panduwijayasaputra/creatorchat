import { prepareTestDatabase } from '@creatorchat/db/testing';

export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}
