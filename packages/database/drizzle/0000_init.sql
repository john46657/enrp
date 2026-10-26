CREATE TYPE "public"."account_link_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."oauth_purpose" AS ENUM('dashboard_login', 'verify_start', 'verify_discord', 'roblox_verify');--> statement-breakpoint
CREATE TYPE "public"."verification_outcome" AS ENUM('success', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."api_key_kind" AS ENUM('roblox_server');--> statement-breakpoint
CREATE TYPE "public"."override_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."duty_status" AS ENUM('active', 'completed', 'auto_closed', 'invalidated');--> statement-breakpoint
CREATE TYPE "public"."game_server_status" AS ENUM('online', 'offline');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('active', 'maintenance', 'disabled', 'retired');--> statement-breakpoint
CREATE TYPE "public"."case_reference_kind" AS ENUM('url', 'report', 'ticket', 'moderation_action', 'discord_message');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('ticket', 'report', 'case', 'incident', 'appeal');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'in_review', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'claimed', 'waiting', 'closed');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('open', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."moderation_platform" AS ENUM('discord', 'roblox');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('active', 'expired', 'revoked', 'pending_execution', 'failed', 'completed');--> statement-breakpoint
CREATE TYPE "public"."moderation_type" AS ENUM('warn', 'timeout', 'kick', 'ban', 'unban', 'note');--> statement-breakpoint
CREATE TYPE "public"."announcement_kind" AS ENUM('general', 'changelog', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."announcement_status" AS ENUM('draft', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."code_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."giveaway_status" AS ENUM('open', 'drawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('scheduled', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."rule_set_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('open', 'under_review', 'accepted', 'rejected', 'implemented');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'service', 'system', 'roblox_server');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."automation_action" AS ENUM('notify_discord', 'create_incident', 'run_health_check');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger" AS ENUM('backup_failed', 'service_down', 'release_deployed', 'roblox_disconnected', 'incident_created', 'error_rate_high');--> statement-breakpoint
CREATE TYPE "public"."backup_status" AS ENUM('running', 'verifying', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('sev1', 'sev2', 'sev3', 'sev4');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'monitoring', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('pending', 'awaiting_approval', 'processing', 'completed', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('export', 'deletion');--> statement-breakpoint
CREATE TYPE "public"."release_status" AS ENUM('prepared', 'approved', 'deploying', 'deployed', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."security_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TABLE "account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"status" "account_link_status" DEFAULT 'active' NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"global_name" text,
	"avatar_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state_hash" text PRIMARY KEY NOT NULL,
	"purpose" "oauth_purpose" NOT NULL,
	"discord_user_id" text,
	"code_verifier" text NOT NULL,
	"nonce" text,
	"redirect_path" text,
	"browser_binding_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "play_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"server_id" uuid,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	"duration_seconds" integer
);
--> statement-breakpoint
CREATE TABLE "profile_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text,
	"roblox_user_id" bigint,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"data" text,
	"actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roblox_users" (
	"id" bigint PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"account_created_at" timestamp with time zone,
	"total_playtime_seconds" bigint DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_user_id" text NOT NULL,
	"roblox_user_id" bigint,
	"outcome" "verification_outcome" NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"discord_user_id" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "api_key_kind" NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"allowed_place_ids" text[],
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "app_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "command_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"command" text NOT NULL,
	"discord_role_id" text NOT NULL,
	"effect" "override_effect" NOT NULL,
	"created_by" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_role_cache" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"role_ids" text[] NOT NULL,
	"in_guild" boolean NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "role_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"discord_role_id" text,
	"discord_user_id" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_bindings_target_chk" CHECK (("role_bindings"."discord_role_id" is null) <> ("role_bindings"."discord_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"faction_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "duty_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "duty_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"faction_id" uuid NOT NULL,
	"server_id" uuid,
	"status" "duty_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"end_reason" text,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_sessions_end_chk" CHECK ("duty_sessions"."ended_at" is null or "duty_sessions"."ended_at" >= "duty_sessions"."started_at")
);
--> statement-breakpoint
CREATE TABLE "faction_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"faction_id" uuid NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by" text NOT NULL,
	"add_reason" text,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"end_reason" text
);
--> statement-breakpoint
CREATE TABLE "factions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"discord_role_id" text,
	"has_duty" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "factions_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "game_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid,
	"api_key_id" uuid,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"status" text DEFAULT 'processed' NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"place_id" text NOT NULL,
	"place_version" integer,
	"api_key_id" uuid,
	"status" "game_server_status" DEFAULT 'online' NOT NULL,
	"player_count" integer DEFAULT 0 NOT NULL,
	"max_players" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "game_servers_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"unassigned_at" timestamp with time zone,
	"unassigned_by" text,
	"unassign_reason" text
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"faction_id" uuid,
	"status" "vehicle_status" DEFAULT 'active' NOT NULL,
	"allowed_configs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "case_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "case_reference_kind" NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "case_reports_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"status" "case_status" DEFAULT 'open' NOT NULL,
	"subject_roblox_id" bigint,
	"subject_discord_id" text,
	"created_by" text NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_reports_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "record_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_type" "record_type" NOT NULL,
	"record_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"body" text,
	"internal" boolean DEFAULT false NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "reports_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reporter_discord_id" text NOT NULL,
	"reported_roblox_id" bigint,
	"reported_discord_id" text,
	"rule_reference" text,
	"description" text NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"assignee_discord_id" text,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "tickets_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"category" text DEFAULT 'general' NOT NULL,
	"subject" text NOT NULL,
	"status" "ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"creator_discord_id" text NOT NULL,
	"assignee_discord_id" text,
	"team" text,
	"discord_channel_id" text,
	"close_reason" text,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "tickets_discord_channel_id_unique" UNIQUE("discord_channel_id")
);
--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_id" uuid NOT NULL,
	"appellant_discord_id" text NOT NULL,
	"statement" text NOT NULL,
	"status" "appeal_status" DEFAULT 'open' NOT NULL,
	"reviewer_id" text,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeals_reviewer_chk" CHECK ("appeals"."reviewer_id" is null or "appeals"."reviewer_id" <> "appeals"."appellant_discord_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "moderation_actions_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "moderation_type" NOT NULL,
	"platform" "moderation_platform" DEFAULT 'discord' NOT NULL,
	"target_discord_id" text,
	"target_roblox_id" bigint,
	"moderator_id" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "moderation_status" NOT NULL,
	"executed_at" timestamp with time zone,
	"execution_error" text,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"related_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_number_unique" UNIQUE("number"),
	CONSTRAINT "moderation_actions_target_chk" CHECK ("moderation_actions"."target_discord_id" is not null or "moderation_actions"."target_roblox_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "announcement_kind" DEFAULT 'general' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"version" text,
	"discord_channel_id" text,
	"in_game" boolean DEFAULT false NOT NULL,
	"status" "announcement_status" DEFAULT 'draft' NOT NULL,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_id" uuid NOT NULL,
	"roblox_user_id" bigint NOT NULL,
	"server_id" uuid,
	"idempotency_key" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "code_redemptions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "giveaway_entries" (
	"giveaway_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "giveaway_entries_giveaway_id_discord_user_id_pk" PRIMARY KEY("giveaway_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "giveaways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prize" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"winner_count" integer DEFAULT 1 NOT NULL,
	"require_verified" boolean DEFAULT true NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "giveaway_status" DEFAULT 'open' NOT NULL,
	"discord_channel_id" text,
	"discord_message_id" text,
	"created_by" text NOT NULL,
	"drawn_at" timestamp with time zone,
	"drawn_by" text,
	"winners" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "maintenance_status" DEFAULT 'scheduled' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_votes" (
	"poll_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"option_ids" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_poll_id_discord_user_id_pk" PRIMARY KEY("poll_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"multiple_choice" boolean DEFAULT false NOT NULL,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"closes_at" timestamp with time zone,
	"discord_channel_id" text,
	"discord_message_id" text,
	"created_by" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"hint" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reward_type" text NOT NULL,
	"reward_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"max_redemptions" integer,
	"per_user_limit" integer DEFAULT 1 NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" "code_status" DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "reward_codes_limit_chk" CHECK ("reward_codes"."max_redemptions" is null or "reward_codes"."redemption_count" <= "reward_codes"."max_redemptions"),
	CONSTRAINT "reward_codes_per_user_chk" CHECK ("reward_codes"."per_user_limit" >= 1)
);
--> statement-breakpoint
CREATE TABLE "rule_acceptances" (
	"rule_set_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_acceptances_rule_set_id_discord_user_id_pk" PRIMARY KEY("rule_set_id","discord_user_id")
);
--> statement-breakpoint
CREATE TABLE "rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"status" "rule_set_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_sets_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "suggestion_votes" (
	"suggestion_id" uuid NOT NULL,
	"discord_user_id" text NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestion_votes_suggestion_id_discord_user_id_pk" PRIMARY KEY("suggestion_id","discord_user_id"),
	CONSTRAINT "suggestion_votes_value_chk" CHECK ("suggestion_votes"."value" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "suggestions_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"author_discord_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" "suggestion_status" DEFAULT 'open' NOT NULL,
	"status_reason" text,
	"status_changed_by" text,
	"discord_channel_id" text,
	"discord_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suggestions_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "approval_requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"action_type" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"executed_at" timestamp with time zone,
	"executed_by" text,
	"execution_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "approval_requests_no_self_chk" CHECK ("approval_requests"."decided_by" is null or "approval_requests"."decided_by" <> "approval_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"request_id" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"trigger" "automation_trigger" NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action" "automation_action" NOT NULL,
	"action_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cooldown_seconds" integer DEFAULT 900 NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"status" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text DEFAULT 'scheduled' NOT NULL,
	"status" "backup_status" DEFAULT 'running' NOT NULL,
	"file_name" text,
	"storage_location" text,
	"size_bytes" bigint,
	"sha256" text,
	"verified_at" timestamp with time zone,
	"verification" jsonb,
	"error" text,
	"triggered_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "config_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"version" integer NOT NULL,
	"value" jsonb,
	"previous" jsonb,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"current_version" text,
	"config_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key_pk" PRIMARY KEY("scope","key")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "incidents_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"severity" "incident_severity" DEFAULT 'sev3' NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"assignee_id" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"dedupe_key" text,
	"created_by" text NOT NULL,
	"resolution" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text NOT NULL,
	"name" text NOT NULL,
	"job_id" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"result" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "privacy_requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"type" "privacy_request_type" NOT NULL,
	"subject_discord_id" text,
	"subject_roblox_id" bigint,
	"status" "privacy_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"approval_request_id" uuid,
	"preview" jsonb,
	"result" jsonb,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_number_unique" UNIQUE("number"),
	CONSTRAINT "privacy_requests_subject_chk" CHECK ("privacy_requests"."subject_discord_id" is not null or "privacy_requests"."subject_roblox_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "releases_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"version" text NOT NULL,
	"environment_id" uuid NOT NULL,
	"kind" text DEFAULT 'deploy' NOT NULL,
	"status" "release_status" DEFAULT 'prepared' NOT NULL,
	"commit_sha" text,
	"notes" text DEFAULT '' NOT NULL,
	"prepared_by" text NOT NULL,
	"approved_by" text,
	"approval_request_id" uuid,
	"pipeline_run_url" text,
	"deployed_at" timestamp with time zone,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_number_unique" UNIQUE("number"),
	CONSTRAINT "releases_no_self_approval_chk" CHECK ("releases"."approved_by" is null or "releases"."approved_by" <> "releases"."prepared_by")
);
--> statement-breakpoint
CREATE TABLE "request_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"api_key_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "restore_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"backup_id" uuid NOT NULL,
	"target_environment" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"preview" jsonb,
	"requested_by" text NOT NULL,
	"reason" text NOT NULL,
	"approval_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"severity" "security_severity" DEFAULT 'warning' NOT NULL,
	"actor_id" text,
	"ip_hash" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "service_heartbeats" (
	"service" text NOT NULL,
	"instance_id" text NOT NULL,
	"version" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"info" jsonb,
	CONSTRAINT "service_heartbeats_service_instance_id_pk" PRIMARY KEY("service","instance_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_discord_user_id_discord_users_id_fk" FOREIGN KEY ("discord_user_id") REFERENCES "public"."discord_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_roblox_user_id_roblox_users_id_fk" FOREIGN KEY ("roblox_user_id") REFERENCES "public"."roblox_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_sessions" ADD CONSTRAINT "play_sessions_roblox_user_id_roblox_users_id_fk" FOREIGN KEY ("roblox_user_id") REFERENCES "public"."roblox_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_bindings" ADD CONSTRAINT "role_bindings_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_corrections" ADD CONSTRAINT "duty_corrections_session_id_duty_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."duty_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_roblox_user_id_roblox_users_id_fk" FOREIGN KEY ("roblox_user_id") REFERENCES "public"."roblox_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_sessions" ADD CONSTRAINT "duty_sessions_server_id_game_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."game_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_memberships" ADD CONSTRAINT "faction_memberships_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_memberships" ADD CONSTRAINT "faction_memberships_roblox_user_id_roblox_users_id_fk" FOREIGN KEY ("roblox_user_id") REFERENCES "public"."roblox_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_roblox_user_id_roblox_users_id_fk" FOREIGN KEY ("roblox_user_id") REFERENCES "public"."roblox_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_references" ADD CONSTRAINT "case_references_case_id_case_reports_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."case_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_action_id_moderation_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."moderation_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_code_id_reward_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."reward_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_giveaway_id_giveaways_id_fk" FOREIGN KEY ("giveaway_id") REFERENCES "public"."giveaways"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_acceptances" ADD CONSTRAINT "rule_acceptances_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_votes" ADD CONSTRAINT "suggestion_votes_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_requests" ADD CONSTRAINT "restore_requests_backup_id_backup_runs_id_fk" FOREIGN KEY ("backup_id") REFERENCES "public"."backup_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_links_active_discord_uq" ON "account_links" USING btree ("discord_user_id") WHERE "account_links"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "account_links_active_roblox_uq" ON "account_links" USING btree ("roblox_user_id") WHERE "account_links"."status" = 'active';--> statement-breakpoint
CREATE INDEX "account_links_roblox_idx" ON "account_links" USING btree ("roblox_user_id");--> statement-breakpoint
CREATE INDEX "oauth_states_expires_idx" ON "oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "play_sessions_user_idx" ON "play_sessions" USING btree ("roblox_user_id","joined_at");--> statement-breakpoint
CREATE UNIQUE INDEX "play_sessions_open_uq" ON "play_sessions" USING btree ("roblox_user_id") WHERE "play_sessions"."left_at" is null;--> statement-breakpoint
CREATE INDEX "profile_events_discord_idx" ON "profile_events" USING btree ("discord_user_id","created_at");--> statement-breakpoint
CREATE INDEX "profile_events_roblox_idx" ON "profile_events" USING btree ("roblox_user_id","created_at");--> statement-breakpoint
CREATE INDEX "roblox_users_username_idx" ON "roblox_users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "verifications_discord_idx" ON "verifications" USING btree ("discord_user_id","created_at");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("discord_user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expires_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "command_overrides_uq" ON "command_overrides" USING btree ("command","discord_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_bindings_role_discord_role_uq" ON "role_bindings" USING btree ("role_id","discord_role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_bindings_role_discord_user_uq" ON "role_bindings" USING btree ("role_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "role_bindings_discord_role_idx" ON "role_bindings" USING btree ("discord_role_id");--> statement-breakpoint
CREATE INDEX "role_bindings_discord_user_idx" ON "role_bindings" USING btree ("discord_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "duty_sessions_active_uq" ON "duty_sessions" USING btree ("roblox_user_id") WHERE "duty_sessions"."status" = 'active';--> statement-breakpoint
CREATE INDEX "duty_sessions_user_idx" ON "duty_sessions" USING btree ("roblox_user_id","started_at");--> statement-breakpoint
CREATE INDEX "duty_sessions_faction_idx" ON "duty_sessions" USING btree ("faction_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "faction_memberships_active_uq" ON "faction_memberships" USING btree ("roblox_user_id") WHERE "faction_memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "faction_memberships_faction_idx" ON "faction_memberships" USING btree ("faction_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_idem_uq" ON "game_events" USING btree ("api_key_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "game_events_received_idx" ON "game_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "game_servers_status_idx" ON "game_servers" USING btree ("status","last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_assignments_active_uq" ON "vehicle_assignments" USING btree ("vehicle_id","roblox_user_id") WHERE "vehicle_assignments"."unassigned_at" is null;--> statement-breakpoint
CREATE INDEX "vehicle_assignments_user_idx" ON "vehicle_assignments" USING btree ("roblox_user_id");--> statement-breakpoint
CREATE INDEX "vehicles_faction_idx" ON "vehicles" USING btree ("faction_id");--> statement-breakpoint
CREATE INDEX "vehicles_category_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "case_reports_status_idx" ON "case_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "case_reports_subject_roblox_idx" ON "case_reports" USING btree ("subject_roblox_id");--> statement-breakpoint
CREATE INDEX "record_events_record_idx" ON "record_events" USING btree ("record_type","record_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_reported_roblox_idx" ON "reports" USING btree ("reported_roblox_id");--> statement-breakpoint
CREATE INDEX "reports_reported_discord_idx" ON "reports" USING btree ("reported_discord_id");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "tickets_creator_idx" ON "tickets" USING btree ("creator_discord_id");--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assignee_discord_id");--> statement-breakpoint
CREATE INDEX "appeals_status_idx" ON "appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_discord_idx" ON "moderation_actions" USING btree ("target_discord_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_roblox_idx" ON "moderation_actions" USING btree ("target_roblox_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_status_idx" ON "moderation_actions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_moderator_idx" ON "moderation_actions" USING btree ("moderator_id");--> statement-breakpoint
CREATE INDEX "announcements_status_idx" ON "announcements" USING btree ("status","publish_at");--> statement-breakpoint
CREATE INDEX "announcements_ingame_idx" ON "announcements" USING btree ("in_game","published_at");--> statement-breakpoint
CREATE INDEX "code_redemptions_user_idx" ON "code_redemptions" USING btree ("code_id","roblox_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rule_sets_one_published_uq" ON "rule_sets" USING btree ("status") WHERE "rule_sets"."status" = 'published';--> statement-breakpoint
CREATE INDEX "suggestions_status_idx" ON "suggestions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "audit_events_occurred_idx" ON "audit_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_resource_idx" ON "audit_events" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action");--> statement-breakpoint
CREATE INDEX "automation_runs_rule_idx" ON "automation_runs" USING btree ("rule_id","created_at");--> statement-breakpoint
CREATE INDEX "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "config_versions_scope_version_uq" ON "config_versions" USING btree ("scope","version");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_dedupe_uq" ON "incidents" USING btree ("dedupe_key") WHERE "incidents"."status" <> 'resolved' and "incidents"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "job_runs_started_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "job_runs_queue_idx" ON "job_runs" USING btree ("queue","status");--> statement-breakpoint
CREATE INDEX "releases_env_idx" ON "releases" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "request_nonces_received_idx" ON "request_nonces" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "security_events_occurred_idx" ON "security_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "security_events_type_idx" ON "security_events" USING btree ("type");