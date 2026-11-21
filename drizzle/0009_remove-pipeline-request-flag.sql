DROP INDEX "decision_pipelines_user_definition_idx";--> statement-breakpoint
UPDATE "decision_pipelines" AS version
SET "definition_hash" = encode(sha256(convert_to(version."definition_hash" || ':' || version."base_url", 'UTF8')), 'hex')
WHERE NOT version."accepts_request"
  AND version."base_url" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "decision_pipelines" AS entry
    WHERE entry."accepts_request"
      AND entry."user_id" = version."user_id"
      AND entry."definition_hash" = version."definition_hash"
      AND entry."base_url" = version."base_url"
  );--> statement-breakpoint
CREATE UNIQUE INDEX "decision_pipelines_user_definition_idx" ON "decision_pipelines" USING btree ("user_id","definition_hash");--> statement-breakpoint
ALTER TABLE "decision_pipelines" DROP COLUMN "accepts_request";
