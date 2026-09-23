CREATE TABLE "judge_join_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ring_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_join_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "judge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ring_id" uuid NOT NULL,
	"join_code_used" text NOT NULL,
	"judge_name" text NOT NULL,
	"seat_number" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"session_token" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "judge_requests_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "kata_group_standings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"standings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kata_group_standings_category_id_group_id_unique" UNIQUE("category_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "kata_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" text NOT NULL,
	"judge_request_id" uuid NOT NULL,
	"seat_number" integer NOT NULL,
	"side" text NOT NULL,
	"score_tenths" integer NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kata_scores_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "kata_scores_match_id_judge_request_id_side_unique" UNIQUE("match_id","judge_request_id","side")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kata_panel_size" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "aka_kata_number" integer;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "ao_kata_number" integer;--> statement-breakpoint
ALTER TABLE "judge_join_codes" ADD CONSTRAINT "judge_join_codes_ring_id_rings_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."rings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "judge_requests" ADD CONSTRAINT "judge_requests_ring_id_rings_id_fk" FOREIGN KEY ("ring_id") REFERENCES "public"."rings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kata_group_standings" ADD CONSTRAINT "kata_group_standings_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kata_scores" ADD CONSTRAINT "kata_scores_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kata_scores" ADD CONSTRAINT "kata_scores_judge_request_id_judge_requests_id_fk" FOREIGN KEY ("judge_request_id") REFERENCES "public"."judge_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "judge_requests_ring_status_idx" ON "judge_requests" USING btree ("ring_id","status");