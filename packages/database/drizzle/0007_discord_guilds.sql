CREATE TYPE "public"."discord_guild_kind" AS ENUM('private_server', 'other');--> statement-breakpoint
CREATE TABLE "discord_guilds" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "discord_guild_kind" DEFAULT 'other' NOT NULL,
	"private_server_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"sync_bans" boolean DEFAULT false NOT NULL,
	"channels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bot_present" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_guilds_private_server_id_unique" UNIQUE("private_server_id")
);
--> statement-breakpoint
DROP INDEX "role_bindings_role_discord_user_uq";--> statement-breakpoint
ALTER TABLE "role_bindings" ADD COLUMN "guild_id" text;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "guild_id" text;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "global" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "discord_guilds" ADD CONSTRAINT "discord_guilds_private_server_id_private_servers_id_fk" FOREIGN KEY ("private_server_id") REFERENCES "public"."private_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_bindings_role_discord_user_uq" ON "role_bindings" USING btree ("role_id","discord_user_id",coalesce("guild_id", ''));