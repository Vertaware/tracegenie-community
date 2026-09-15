-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'TRIAGER');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'GLOBAL_ADMIN');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('PROJECT_ADMIN', 'TRIAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'READ_ONLY', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('NEW', 'TRIAGED', 'BLOCKED', 'DUPLICATE', 'BACKLOG', 'IN_PROGRESS', 'FIXED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('BUG', 'UX', 'ENHANCEMENT', 'PERFORMANCE', 'DATA', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('SCREENSHOT', 'FILE');

-- CreateEnum
CREATE TYPE "AttachmentVisibility" AS ENUM ('INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "CommentVisibility" AS ENUM ('INTERNAL', 'PUBLIC');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'AZURE_BLOB');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('NEW_ISSUE_ADMIN', 'REQUESTER_CONFIRMATION', 'TRIAGE_REQUESTER', 'STATUS_CHANGE_REQUESTER', 'FIXED_REQUESTER', 'REOPEN_REQUESTER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationProvider" AS ENUM ('SMTP', 'NONE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN_USER', 'INTEGRATION_CLIENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "FeedbackRecipientType" AS ENUM ('REQUESTER', 'EXTERNAL_SUBSCRIBER', 'INTERNAL_SUBSCRIBER');

-- CreateEnum
CREATE TYPE "ProjectAutoFixPolicy" AS ENUM ('DISABLED', 'SUGGEST_ONLY', 'ALLOW_BRANCH');

-- CreateEnum
CREATE TYPE "ProjectReviewerPolicy" AS ENUM ('NONE', 'HUMAN_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "ProjectRequesterNotificationPolicy" AS ENUM ('EXPLICIT_ONLY', 'DISABLED');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_environment" TEXT NOT NULL,
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "widget_config" JSONB NOT NULL DEFAULT '{}',
    "notification_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requester_email_product_name" TEXT,
    "widget_client_secret_hash" TEXT,
    "widget_client_secret_rotated_at" TIMESTAMP(3),
    "widget_last_loaded_at" TIMESTAMP(3),
    "widget_session_last_issued_at" TIMESTAMP(3),
    "onboarding_version" INTEGER,
    "onboarding_completed_step" TEXT,
    "onboarding_completed_at" TIMESTAMP(3),
    "onboarding_install_method" TEXT,
    "onboarding_website" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_engineering_contexts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "repository_url" TEXT,
    "default_branch" TEXT,
    "worktree_path" TEXT,
    "install_command" TEXT,
    "test_command" TEXT,
    "build_command" TEXT,
    "auto_fix_policy" "ProjectAutoFixPolicy" NOT NULL DEFAULT 'SUGGEST_ONLY',
    "reviewer_policy" "ProjectReviewerPolicy" NOT NULL DEFAULT 'NONE',
    "requester_notification_policy" "ProjectRequesterNotificationPolicy" NOT NULL DEFAULT 'EXPLICIT_ONLY',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_engineering_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "brand_name" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "accent_color" TEXT,
    "email_footer_text" TEXT,
    "widget_defaults" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_memberships" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "project_ids_json" JSONB,
    "invited_by_user_id" TEXT,
    "invited_by_name" TEXT,
    "email" TEXT NOT NULL,
    "org_role" "OrgRole",
    "project_role" "ProjectRole",
    "token_hash" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_projects" (
    "id" TEXT NOT NULL,
    "invite_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporter_otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reporter_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "actor_user_id" TEXT,
    "event_type" TEXT NOT NULL,
    "reason" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dsar_export_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "subject_email" TEXT,
    "subject_email_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "counts_json" JSONB,
    "artifact_json" JSONB,
    "failure_json" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dsar_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dsar_deletion_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "subject_email_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'admin',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "counts_json" JSONB,
    "deleted_json" JSONB,
    "processing_claim_token" TEXT,
    "processing_claimed_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dsar_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "releases" (
    "id" TEXT NOT NULL,
    "release_key" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "app_name" TEXT NOT NULL,
    "app_environment" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "build_number" TEXT,
    "release_channel" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'TRIAGER',
    "platform_role" "PlatformRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "password_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_issue_views" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_issue_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_items" (
    "id" TEXT NOT NULL,
    "client_submission_id" TEXT,
    "client_submission_fingerprint" TEXT,
    "post_commit_invoice_payload" JSONB,
    "post_commit_claimed_at" TIMESTAMP(3),
    "post_commit_completed_at" TIMESTAMP(3),
    "ticket_number" SERIAL NOT NULL,
    "project_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "release_id" TEXT,
    "owner_id" TEXT,
    "duplicate_of_id" TEXT,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'NEW',
    "issue_type" "IssueType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "steps_to_reproduce" TEXT,
    "expected_result" TEXT,
    "actual_result" TEXT,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "current_url" TEXT NOT NULL,
    "route_name" TEXT,
    "page_title" TEXT,
    "referrer" TEXT,
    "app_name" TEXT NOT NULL,
    "app_environment" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "build_number" TEXT,
    "release_channel" TEXT,
    "browser_user_agent" TEXT NOT NULL,
    "browser_language" TEXT,
    "browser_platform" TEXT,
    "browser_name" TEXT,
    "browser_version" TEXT,
    "os_name" TEXT,
    "os_version" TEXT,
    "viewport_width" INTEGER NOT NULL,
    "viewport_height" INTEGER NOT NULL,
    "reporter_id" TEXT,
    "reporter_email" TEXT,
    "reporter_name" TEXT,
    "reporter_role" TEXT,
    "client_timestamp" TIMESTAMP(3) NOT NULL,
    "console_entries" JSONB,
    "client_error_context" JSONB,
    "extra_context" JSONB,
    "duplicate_fingerprint" TEXT,
    "duplicate_candidates" JSONB,
    "converted_to_backlog" BOOLEAN NOT NULL DEFAULT false,
    "external_ticket_ref" TEXT,
    "requester_notifications_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_overage_locked" BOOLEAN NOT NULL DEFAULT false,
    "usage_month" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_attachments" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "client_upload_id" TEXT,
    "client_upload_fingerprint" TEXT,
    "feedback_item_id" TEXT,
    "upload_token" TEXT,
    "kind" "AttachmentType" NOT NULL DEFAULT 'SCREENSHOT',
    "visibility" "AttachmentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "provider" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storage_key" TEXT NOT NULL,
    "public_url" TEXT,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "uploaded_by_ip" TEXT,
    "linked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_comments" (
    "id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "author_id" TEXT,
    "client_request_id" TEXT,
    "body" TEXT NOT NULL,
    "visibility" "CommentVisibility" NOT NULL DEFAULT 'INTERNAL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_status_history" (
    "id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "from_status" "FeedbackStatus",
    "to_status" "FeedbackStatus" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "integration_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_lifecycle_transitions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "integration_client_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "external_id" TEXT,
    "external_url" TEXT,
    "label" TEXT,
    "safe_details" JSONB,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_lifecycle_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_triage_runs" (
    "id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "integration_client_id" TEXT,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'INTEGRATION_CLIENT',
    "triage_version" TEXT NOT NULL DEFAULT 'v1',
    "suggested_severity" "Severity",
    "suggested_issue_type" "IssueType",
    "suggested_category" TEXT,
    "likely_root_cause" TEXT,
    "affected_area" TEXT,
    "reproduction_steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "next_action" TEXT,
    "confidence" DOUBLE PRECISION,
    "safe_requester_summary" TEXT,
    "raw_payload" JSONB,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_triage_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_notifications" (
    "id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "feedback_recipient_id" TEXT,
    "integration_client_id" TEXT,
    "event_type" "NotificationEventType" NOT NULL,
    "recipient_email" TEXT,
    "recipient_name" TEXT,
    "recipient_type" "FeedbackRecipientType" NOT NULL DEFAULT 'REQUESTER',
    "dedupe_key" TEXT NOT NULL,
    "trigger_status" "FeedbackStatus",
    "from_name" TEXT,
    "from_email" TEXT,
    "reply_to_email" TEXT,
    "product_name_snapshot" TEXT,
    "subject_snapshot" TEXT,
    "body_snapshot" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "NotificationProvider",
    "provider_message_id" TEXT,
    "skip_reason" TEXT,
    "error_json" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_ticket_recipients" (
    "id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "added_by_admin_user_id" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "recipient_type" "FeedbackRecipientType" NOT NULL,
    "notify_on_triage" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_status_change" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_ticket_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_audit_events" (
    "id" TEXT NOT NULL,
    "feedback_item_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "actor_type" "AuditActorType" NOT NULL,
    "admin_user_id" TEXT,
    "integration_client_id" TEXT,
    "event_type" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "request_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_key_key" ON "projects"("key");

-- CreateIndex
CREATE INDEX "projects_organization_id_name_idx" ON "projects"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_id_key" ON "projects"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "project_engineering_contexts_project_id_key" ON "project_engineering_contexts"("project_id");

-- CreateIndex
CREATE INDEX "project_engineering_contexts_auto_fix_policy_idx" ON "project_engineering_contexts"("auto_fix_policy");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "org_memberships_user_id_status_idx" ON "org_memberships"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_organization_id_user_id_key" ON "org_memberships"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "project_memberships_user_id_status_idx" ON "project_memberships"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_memberships_project_id_user_id_key" ON "project_memberships"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_organization_id_status_created_at_idx" ON "invites"("organization_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "invites_invited_by_user_id_idx" ON "invites"("invited_by_user_id");

-- CreateIndex
CREATE INDEX "invites_email_status_idx" ON "invites"("email", "status");

-- CreateIndex
CREATE INDEX "invite_projects_project_id_idx" ON "invite_projects"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_projects_invite_id_project_id_key" ON "invite_projects"("invite_id", "project_id");

-- CreateIndex
CREATE INDEX "reporter_otps_email_created_at_idx" ON "reporter_otps"("email", "created_at");

-- CreateIndex
CREATE INDEX "reporter_otps_email_used_at_expires_at_idx" ON "reporter_otps"("email", "used_at", "expires_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_organization_id_created_at_idx" ON "platform_audit_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_actor_user_id_created_at_idx" ON "platform_audit_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "dsar_export_requests_organization_id_created_at_idx" ON "dsar_export_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "dsar_export_requests_status_next_attempt_at_created_at_idx" ON "dsar_export_requests"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "dsar_deletion_requests_organization_id_created_at_idx" ON "dsar_deletion_requests"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "dsar_deletion_requests_status_created_at_idx" ON "dsar_deletion_requests"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "releases_release_key_key" ON "releases"("release_key");

-- CreateIndex
CREATE INDEX "releases_project_id_app_version_idx" ON "releases"("project_id", "app_version");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "saved_issue_views_organization_id_user_id_updated_at_idx" ON "saved_issue_views"("organization_id", "user_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "saved_issue_views_organization_id_user_id_name_key" ON "saved_issue_views"("organization_id", "user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_expires_at_idx" ON "password_reset_tokens"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_consumed_at_idx" ON "password_reset_tokens"("expires_at", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_items_ticket_number_key" ON "feedback_items"("ticket_number");

-- CreateIndex
CREATE INDEX "feedback_items_organization_id_created_at_idx" ON "feedback_items"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_items_project_id_status_created_at_idx" ON "feedback_items"("project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_items_project_id_severity_created_at_idx" ON "feedback_items"("project_id", "severity", "created_at");

-- CreateIndex
CREATE INDEX "feedback_items_project_id_issue_type_created_at_idx" ON "feedback_items"("project_id", "issue_type", "created_at");

-- CreateIndex
CREATE INDEX "feedback_items_duplicate_fingerprint_idx" ON "feedback_items"("duplicate_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_items_project_id_client_submission_id_key" ON "feedback_items"("project_id", "client_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_items_organization_id_project_id_id_key" ON "feedback_items"("organization_id", "project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_attachments_upload_token_key" ON "feedback_attachments"("upload_token");

-- CreateIndex
CREATE INDEX "feedback_attachments_project_id_created_at_idx" ON "feedback_attachments"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_attachments_project_id_client_upload_id_key" ON "feedback_attachments"("project_id", "client_upload_id");

-- CreateIndex
CREATE INDEX "feedback_comments_feedback_item_id_created_at_idx" ON "feedback_comments"("feedback_item_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_comments_feedback_item_id_client_request_id_key" ON "feedback_comments"("feedback_item_id", "client_request_id");

-- CreateIndex
CREATE INDEX "feedback_status_history_feedback_item_id_created_at_idx" ON "feedback_status_history"("feedback_item_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_lifecycle_transitions_feedback_item_id_observed_at_idx" ON "feedback_lifecycle_transitions"("feedback_item_id", "observed_at", "created_at");

-- CreateIndex
CREATE INDEX "feedback_lifecycle_transitions_feedback_item_id_provider_st_idx" ON "feedback_lifecycle_transitions"("feedback_item_id", "provider", "stage", "observed_at", "created_at");

-- CreateIndex
CREATE INDEX "feedback_lifecycle_transitions_organization_id_created_at_idx" ON "feedback_lifecycle_transitions"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_lifecycle_transitions_organization_id_provider_pro_key" ON "feedback_lifecycle_transitions"("organization_id", "provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "feedback_triage_runs_feedback_item_id_created_at_idx" ON "feedback_triage_runs"("feedback_item_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_triage_runs_integration_client_id_created_at_idx" ON "feedback_triage_runs"("integration_client_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_triage_runs_integration_client_id_idempotency_key_key" ON "feedback_triage_runs"("integration_client_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_notifications_dedupe_key_key" ON "feedback_notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "feedback_notifications_feedback_item_id_created_at_idx" ON "feedback_notifications"("feedback_item_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_notifications_status_created_at_idx" ON "feedback_notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "feedback_notifications_status_next_attempt_at_created_at_idx" ON "feedback_notifications"("status", "next_attempt_at", "created_at");

-- CreateIndex
CREATE INDEX "feedback_ticket_recipients_feedback_item_id_is_active_creat_idx" ON "feedback_ticket_recipients"("feedback_item_id", "is_active", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_ticket_recipients_feedback_item_id_email_key" ON "feedback_ticket_recipients"("feedback_item_id", "email");

-- CreateIndex
CREATE INDEX "feedback_audit_events_feedback_item_id_created_at_idx" ON "feedback_audit_events"("feedback_item_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_audit_events_project_id_created_at_idx" ON "feedback_audit_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "feedback_audit_events_integration_client_id_created_at_idx" ON "feedback_audit_events"("integration_client_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_audit_events_integration_client_id_event_type_idem_key" ON "feedback_audit_events"("integration_client_id", "event_type", "idempotency_key");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_engineering_contexts" ADD CONSTRAINT "project_engineering_contexts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_projects" ADD CONSTRAINT "invite_projects_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_projects" ADD CONSTRAINT "invite_projects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_export_requests" ADD CONSTRAINT "dsar_export_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_export_requests" ADD CONSTRAINT "dsar_export_requests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_deletion_requests" ADD CONSTRAINT "dsar_deletion_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsar_deletion_requests" ADD CONSTRAINT "dsar_deletion_requests_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_issue_views" ADD CONSTRAINT "saved_issue_views_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_issue_views" ADD CONSTRAINT "saved_issue_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "feedback_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_items" ADD CONSTRAINT "feedback_items_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "releases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_attachments" ADD CONSTRAINT "feedback_attachments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_comments" ADD CONSTRAINT "feedback_comments_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_status_history" ADD CONSTRAINT "feedback_status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_status_history" ADD CONSTRAINT "feedback_status_history_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_lifecycle_transitions" ADD CONSTRAINT "feedback_lifecycle_transitions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_lifecycle_transitions" ADD CONSTRAINT "feedback_lifecycle_transitions_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "projects"("organization_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_lifecycle_transitions" ADD CONSTRAINT "feedback_lifecycle_transitions_organization_id_project_id__fkey" FOREIGN KEY ("organization_id", "project_id", "feedback_item_id") REFERENCES "feedback_items"("organization_id", "project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_lifecycle_transitions" ADD CONSTRAINT "feedback_lifecycle_transitions_integration_client_id_fkey" FOREIGN KEY ("integration_client_id") REFERENCES "integration_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_triage_runs" ADD CONSTRAINT "feedback_triage_runs_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_triage_runs" ADD CONSTRAINT "feedback_triage_runs_integration_client_id_fkey" FOREIGN KEY ("integration_client_id") REFERENCES "integration_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_notifications" ADD CONSTRAINT "feedback_notifications_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_notifications" ADD CONSTRAINT "feedback_notifications_feedback_recipient_id_fkey" FOREIGN KEY ("feedback_recipient_id") REFERENCES "feedback_ticket_recipients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_notifications" ADD CONSTRAINT "feedback_notifications_integration_client_id_fkey" FOREIGN KEY ("integration_client_id") REFERENCES "integration_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_ticket_recipients" ADD CONSTRAINT "feedback_ticket_recipients_added_by_admin_user_id_fkey" FOREIGN KEY ("added_by_admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_ticket_recipients" ADD CONSTRAINT "feedback_ticket_recipients_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_audit_events" ADD CONSTRAINT "feedback_audit_events_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_audit_events" ADD CONSTRAINT "feedback_audit_events_integration_client_id_fkey" FOREIGN KEY ("integration_client_id") REFERENCES "integration_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_audit_events" ADD CONSTRAINT "feedback_audit_events_feedback_item_id_fkey" FOREIGN KEY ("feedback_item_id") REFERENCES "feedback_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_audit_events" ADD CONSTRAINT "feedback_audit_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Community is one installation with one project, enforced under concurrent writes.
CREATE UNIQUE INDEX community_single_project ON projects ((true));
CREATE UNIQUE INDEX community_single_installation ON organizations ((true));
ALTER TABLE admin_users ADD CONSTRAINT community_no_platform_admin CHECK (platform_role = 'USER');
