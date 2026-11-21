import type { PrismaClient } from '@creatorchat/db';

type Tx = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

/**
 * Gives a READY asset the creator's next "Media #N" and a gallery item: the one place that numbers
 * the gallery. The caller holds a transaction and the asset's row lock; running it twice for the
 * same asset changes nothing (the second call finds the item and returns the same number is not
 * promised, only that no second item is made).
 */
export async function addToGallery(tx: Tx, creatorId: string, assetId: string): Promise<void> {
  const [counter] = await tx.$queryRaw<{ seq: number }[]>`
    UPDATE creators SET last_gallery_seq = last_gallery_seq + 1
    WHERE id = ${creatorId}::uuid RETURNING last_gallery_seq AS seq`;
  await tx.$executeRaw`
    INSERT INTO gallery_items (creator_id, asset_id, seq)
    VALUES (${creatorId}::uuid, ${assetId}::uuid, ${counter?.seq ?? 1})
    ON CONFLICT (creator_id, asset_id) DO NOTHING`;
}
