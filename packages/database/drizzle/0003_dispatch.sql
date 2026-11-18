CREATE TYPE "public"."dispatch_source" AS ENUM('ingame', 'discord', 'dashboard');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('open', 'assigned', 'en_route', 'on_scene', 'closed');--> statement-breakpoint
CREATE TYPE "public"."mod_call_status" AS ENUM('open', 'claimed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."unit_status" AS ENUM('available', 'en_route', 'on_scene', 'busy', 'off_duty');--> statement-breakpoint
ALTER TYPE "public"."record_type" ADD VALUE 'dispatch';--> statement-breakpoint
CREATE TABLE "dispatch_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"unit_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispatch_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "dispatch_incidents_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"source" "dispatch_source" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"department" text NOT NULL,
	"status" "dispatch_status" DEFAULT 'open' NOT NULL,
	"server_id" uuid,
	"caller_roblox_id" bigint,
	"caller_name" text,
	"call_number" integer,
	"position" jsonb,
	"source_event_id" text,
	"discord_channel_id" text,
	"discord_message_id" text,
	"created_by" text NOT NULL,
	"first_assigned_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"report" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatch_incidents_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "dispatch_units" (
	"unit_id" text PRIMARY KEY NOT NULL,
	"callsign" text,
	"status" "unit_status" DEFAULT 'off_duty' NOT NULL,
	"incident_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "mod_calls_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"server_id" uuid,
	"roblox_user_id" bigint NOT NULL,
	"username" text,
	"text" text DEFAULT '' NOT NULL,
	"status" "mod_call_status" DEFAULT 'open' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"note" text,
	"source_event_id" text,
	"discord_channel_id" text,
	"discord_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mod_calls_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "game_servers" ADD COLUMN "live" jsonb;--> statement-breakpoint
ALTER TABLE "dispatch_assignments" ADD CONSTRAINT "dispatch_assignments_incident_id_dispatch_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."dispatch_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_incidents" ADD CONSTRAINT "dispatch_incidents_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatch_units" ADD CONSTRAINT "dispatch_units_incident_id_dispatch_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."dispatch_incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_calls" ADD CONSTRAINT "mod_calls_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_assignments_active_uq" ON "dispatch_assignments" USING btree ("incident_id","unit_id") WHERE "dispatch_assignments"."released_at" is null;--> statement-breakpoint
CREATE INDEX "dispatch_assignments_unit_idx" ON "dispatch_assignments" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "dispatch_incidents_status_idx" ON "dispatch_incidents" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dispatch_incidents_source_event_uq" ON "dispatch_incidents" USING btree ("source_event_id") WHERE "dispatch_incidents"."source_event_id" is not null;--> statement-breakpoint
CREATE INDEX "mod_calls_status_idx" ON "mod_calls" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_calls_source_event_uq" ON "mod_calls" USING btree ("source_event_id") WHERE "mod_calls"."source_event_id" is not null;