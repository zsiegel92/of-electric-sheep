CREATE TABLE "decision_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"definition_hash" text NOT NULL,
	"definition" jsonb NOT NULL,
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_user_id_users_github_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("github_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_pipelines_user_definition_idx" ON "decision_pipelines" USING btree ("user_id","definition_hash");