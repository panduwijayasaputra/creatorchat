-- CreateEnum
CREATE TYPE "AccessRequestType" AS ENUM ('TRIAL', 'RENEWAL');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "access_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customer_id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "type" "AccessRequestType" NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by_admin_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_requests_creator_id_status_created_at_idx" ON "access_requests"("creator_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "access_requests_customer_id_created_at_idx" ON "access_requests"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One pending request per customer and creator: a double tap, a retry or a second tab cannot create another row.
CREATE UNIQUE INDEX "access_requests_one_pending_idx" ON "access_requests"("customer_id", "creator_id") WHERE "status" = 'PENDING';

-- A pending request has no review yet; a rejection always carries the admin's reason; the reason is bounded.
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_review_chk" CHECK (
  ("status" = 'PENDING' AND "reviewed_at" IS NULL AND "reviewed_by_admin_id" IS NULL AND "review_reason" IS NULL)
  OR ("status" = 'APPROVED' AND "reviewed_at" IS NOT NULL)
  OR ("status" = 'REJECTED' AND "reviewed_at" IS NOT NULL AND "review_reason" IS NOT NULL)
);

ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_reason_len_chk" CHECK ("review_reason" IS NULL OR char_length("review_reason") BETWEEN 1 AND 300);
