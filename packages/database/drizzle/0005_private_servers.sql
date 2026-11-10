ALTER TYPE "public"."server_command_type" ADD VALUE 'kick';--> statement-breakpoint
CREATE TABLE "private_server_grants" (
	"link_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"right" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_server_grants_link_id_discord_user_id_right_pk" PRIMARY KEY("link_id","discord_user_id","right")
);
--> statement-breakpoint
CREATE TABLE "private_server_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_roblox_id" bigint NOT NULL,
	"owner_name" text,
	"team_lock" boolean DEFAULT false NOT NULL,
	"team_role_id" text,
	"log_channel_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"linked_by" text NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_server_right_roles" (
	"link_id" uuid NOT NULL,
	"right" text NOT NULL,
	"discord_role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "private_server_right_roles_link_id_right_pk" PRIMARY KEY("link_id","right")
);
--> statement-breakpoint
ALTER TABLE "private_server_grants" ADD CONSTRAINT "private_server_grants_link_id_private_server_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."private_server_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_server_right_roles" ADD CONSTRAINT "private_server_right_roles_link_id_private_server_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."private_server_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "private_server_grants_roblox_idx" ON "private_server_grants" USING btree ("link_id","roblox_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "private_server_links_guild_uq" ON "private_server_links" USING btree ("guild_id") WHERE "private_server_links"."active";--> statement-breakpoint
CREATE INDEX "private_server_links_owner_idx" ON "private_server_links" USING btree ("owner_roblox_id");