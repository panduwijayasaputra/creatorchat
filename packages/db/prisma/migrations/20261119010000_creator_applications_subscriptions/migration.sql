-- Creator requests (US-010) and the minimal customer subscription record the "no active or future
-- subscription" rule needs. Grant / extend / revoke and event history come with Phase C.

-- CreateEnum
CREATE TYPE "CreatorType" AS ENUM ('HUMAN', 'AI_CHARACTER');

-- CreateEnum
CREATE TYPE "CreatorApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "creator_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "creator_name" TEXT NOT NULL,
    "instagram_url" TEXT NOT NULL,
    "creator_type" "CreatorType" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CreatorApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_admin_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "creator_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_applications_user_id_created_at_idx" ON "creator_applications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "subscriptions_customer_id_idx" ON "subscriptions"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_customer_id_creator_id_key" ON "subscriptions"("customer_id", "creator_id");

-- AddForeignKey
ALTER TABLE "creator_applications" ADD CONSTRAINT "creator_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_applications" ADD CONSTRAINT "creator_applications_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One pending request per user: a double tap, a retry or a second tab cannot create another row.
CREATE UNIQUE INDEX "creator_applications_one_pending_idx" ON "creator_applications"("user_id") WHERE "status" = 'PENDING';

-- A pending request has no review yet; a rejection always carries the admin's reason (US-012).
ALTER TABLE "creator_applications" ADD CONSTRAINT "creator_applications_review_chk" CHECK (
  ("status" = 'PENDING' AND "reviewed_at" IS NULL AND "reviewed_by_admin_id" IS NULL AND "review_reason" IS NULL)
  OR ("status" = 'APPROVED' AND "reviewed_at" IS NOT NULL)
  OR ("status" = 'REJECTED' AND "reviewed_at" IS NOT NULL AND "review_reason" IS NOT NULL)
);

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_chk" CHECK ("ends_at" > "starts_at");
