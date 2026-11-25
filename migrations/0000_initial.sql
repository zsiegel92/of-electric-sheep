CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
CREATE TABLE "decision_pipeline_definitions" (
	"pipeline_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"options" jsonb NOT NULL
);
CREATE TABLE "decision_pipeline_questions" (
	"pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"system_prompt" jsonb,
	"criteria" jsonb,
	CONSTRAINT "decision_pipeline_questions_pipeline_id_name_pk" PRIMARY KEY("pipeline_id","name")
);
CREATE TABLE "decision_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"definition_hash" text NOT NULL,
	"primary_grouped_pipeline_id" uuid NOT NULL,
	"display_name" text,
	"ui_ignored" boolean DEFAULT false NOT NULL,
	"base_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_pipelines_user_id_primary_group_key" UNIQUE("user_id","id","primary_grouped_pipeline_id")
);
CREATE TABLE "decision_question_links" (
	"user_id" text NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"primary_pipeline_id" uuid NOT NULL,
	"name" text NOT NULL,
	"primary_name" text NOT NULL,
	"answer_shape" text NOT NULL,
	CONSTRAINT "decision_question_links_pipeline_id_name_pk" PRIMARY KEY("pipeline_id","name"),
	CONSTRAINT "decision_question_links_primary_name_key" UNIQUE("pipeline_id","primary_name"),
	CONSTRAINT "decision_question_links_non_primary" CHECK ("decision_question_links"."pipeline_id" <> "decision_question_links"."primary_pipeline_id")
);
CREATE TABLE "users" (
	"github_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text
);
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_github_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("github_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_pipeline_definitions" ADD CONSTRAINT "decision_pipeline_definitions_pipeline_id_decision_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."decision_pipelines"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_pipeline_questions" ADD CONSTRAINT "decision_pipeline_questions_pipeline_id_decision_pipeline_definitions_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."decision_pipeline_definitions"("pipeline_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_user_id_users_github_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("github_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "decision_pipelines" ADD CONSTRAINT "decision_pipelines_primary_grouped_pipeline_fk" FOREIGN KEY ("user_id","primary_grouped_pipeline_id","primary_grouped_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","id","primary_grouped_pipeline_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "decision_question_links" ADD CONSTRAINT "decision_question_links_group_fk" FOREIGN KEY ("user_id","pipeline_id","primary_pipeline_id") REFERENCES "public"."decision_pipelines"("user_id","id","primary_grouped_pipeline_id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "api_keys_user_id_idx" ON "api_keys" USING btree ("user_id");
CREATE UNIQUE INDEX "decision_pipelines_user_definition_idx" ON "decision_pipelines" USING btree ("user_id","definition_hash");