CREATE TABLE "private_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"private_server_id" text NOT NULL,
	"owner_roblox_id" bigint NOT NULL,
	"name" text,
	"team_lock" boolean DEFAULT false NOT NULL,
	"team_factions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"admins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_servers_private_server_id_unique" UNIQUE("private_server_id")
);
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "private_server_id" text;--> statement-breakpoint
CREATE INDEX "private_servers_owner_idx" ON "private_servers" USING btree ("owner_roblox_id");