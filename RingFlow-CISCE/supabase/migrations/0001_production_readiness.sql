CREATE TABLE "organiser_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"access_code_used" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"session_token" uuid,
	"device_info" jsonb DEFAULT '{}'::jsonb,
	"organiser_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "organiser_requests_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "stager_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"access_code_used" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"session_token" uuid,
	"device_info" jsonb DEFAULT '{}'::jsonb,
	"stager_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "stager_requests_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "bronze_medals" integer;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD COLUMN "total_paused_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD COLUMN "stager_status" text;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD COLUMN "stager_name" text;--> statement-breakpoint
ALTER TABLE "category_assignments" ADD COLUMN "stager_action_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "draws" ADD COLUMN "bronze_medals" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "rings" ADD COLUMN "timer_duration_ms" integer DEFAULT 180000 NOT NULL;--> statement-breakpoint
ALTER TABLE "rings" ADD COLUMN "timer_accumulated_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rings" ADD COLUMN "sides_swapped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "show_public_scoreboard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "default_bronze_medals" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "organiser_requests" ADD CONSTRAINT "organiser_requests_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stager_requests" ADD CONSTRAINT "stager_requests_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;