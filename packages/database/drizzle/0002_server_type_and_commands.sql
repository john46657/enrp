CREATE TYPE "public"."game_server_type" AS ENUM('public', 'private', 'reserved');--> statement-breakpoint
CREATE TYPE "public"."server_command_status" AS ENUM('pending', 'delivered', 'succeeded', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."server_command_type" AS ENUM('message_server', 'message_player', 'shutdown');--> statement-breakpoint
CREATE TABLE "server_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"type" "server_command_type" NOT NULL,
	"roblox_user_id" bigint,
	"message" text,
	"reason" text NOT NULL,
	"status" "server_command_status" DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "server_type" "game_server_type" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "private_server_owner_id" bigint;--> statement-breakpoint
ALTER TABLE "server_commands" ADD CONSTRAINT "server_commands_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_commands_server_idx" ON "server_commands" USING btree ("server_id","status");--> statement-breakpoint
CREATE INDEX "server_commands_created_idx" ON "server_commands" USING btree ("created_at");