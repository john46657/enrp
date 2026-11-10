CREATE TYPE "public"."bolo_kind" AS ENUM('person', 'vehicle');--> statement-breakpoint
CREATE TYPE "public"."bolo_status" AS ENUM('active', 'resolved', 'expired');--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'heal';--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'kill';--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'respawn';--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'jail';--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'unjail';--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'wanted';--> statement-breakpoint
ALTER TYPE "public"."server_command_type" ADD VALUE 'team';--> statement-breakpoint
CREATE TABLE "bolos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "bolos_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "bolo_kind" NOT NULL,
	"status" "bolo_status" DEFAULT 'active' NOT NULL,
	"roblox_user_id" bigint,
	"person_name" text,
	"plate" text,
	"plate_normalized" text,
	"vehicle_description" text,
	"reason" text NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"last_hit_server_id" uuid,
	"last_hit" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"resolve_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bolos_number_unique" UNIQUE("number"),
	CONSTRAINT "bolos_target_chk" CHECK (("bolos"."kind" = 'person' and "bolos"."roblox_user_id" is not null) or ("bolos"."kind" = 'vehicle' and "bolos"."plate_normalized" is not null and "bolos"."plate_normalized" <> ''))
);
--> statement-breakpoint
ALTER TABLE "server_commands" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "bolos" ADD CONSTRAINT "bolos_last_hit_server_id_game_servers_id_fk" FOREIGN KEY ("last_hit_server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bolos_status_idx" ON "bolos" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "bolos_plate_idx" ON "bolos" USING btree ("plate_normalized") WHERE "bolos"."status" = 'active';--> statement-breakpoint
CREATE INDEX "bolos_person_idx" ON "bolos" USING btree ("roblox_user_id") WHERE "bolos"."status" = 'active';--> statement-breakpoint
CREATE INDEX "server_commands_player_idx" ON "server_commands" USING btree ("roblox_user_id","created_at");