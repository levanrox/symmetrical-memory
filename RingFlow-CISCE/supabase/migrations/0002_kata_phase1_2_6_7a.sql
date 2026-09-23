CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batch_items_batch_id_entity_entity_id_unique" UNIQUE("batch_id","entity","entity_id")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text,
	"row_counts" jsonb DEFAULT '{"created":0,"updated":0,"skipped":0,"errors":0}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "athletes" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kata_format" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kata_group_size" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kata_advance_per_group" integer;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "kata_ranking_method" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "category_entries" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "draws" ADD COLUMN "kata_groups" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "import_batch_items" ADD CONSTRAINT "import_batch_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_entries" ADD CONSTRAINT "category_entries_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;