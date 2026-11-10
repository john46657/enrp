CREATE TYPE "public"."bolo_kind" AS ENUM('vehicle', 'person');--> statement-breakpoint
CREATE TYPE "public"."bolo_status" AS ENUM('active', 'cleared');--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'player_action';--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'bolo';--> statement-breakpoint
CREATE TABLE "bolos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "bolos_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "bolo_kind" NOT NULL,
	"plate" text,
	"roblox_user_id" bigint,
	"description" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"status" "bolo_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_by" text,
	"cleared_at" timestamp with time zone,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"last_hit_server_id" uuid,
	"last_hit" jsonb,
	CONSTRAINT "bolos_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "server_commands" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "server_commands" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "bolos" ADD CONSTRAINT "bolos_last_hit_server_id_game_servers_id_fk" FOREIGN KEY ("last_hit_server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bolos_status_idx" ON "bolos" USING btree ("status","kind");