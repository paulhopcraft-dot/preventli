CREATE TABLE "agent_actions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"case_id" varchar,
	"action_type" text NOT NULL,
	"reasoning" text,
	"args" jsonb,
	"result" jsonb,
	"auto_executed" boolean DEFAULT true,
	"approval_status" text,
	"approved_by" varchar,
	"approved_at" timestamp,
	"executed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"case_id" varchar,
	"agent_type" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"triggered_by" text NOT NULL,
	"triggered_by_user_id" varchar,
	"context" jsonb,
	"summary" text,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "case_documents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar,
	"worker_id" varchar,
	"document_type" text,
	"file_url" text NOT NULL,
	"file_name" text,
	"source" text,
	"extracted_data" jsonb,
	"notes" text,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "case_emails" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar,
	"in_reply_to" varchar,
	"case_id" varchar,
	"organization_id" varchar,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_email" text,
	"subject" text NOT NULL,
	"body_text" text,
	"body_html" text,
	"attachment_count" integer DEFAULT 0,
	"attachments_json" jsonb,
	"processing_status" text DEFAULT 'received' NOT NULL,
	"match_method" text,
	"match_confidence" numeric(3, 2),
	"source" text DEFAULT 'sendgrid' NOT NULL,
	"received_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "case_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "case_lifecycle_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"from_stage" text NOT NULL,
	"to_stage" text NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp DEFAULT now(),
	"reason" text,
	"automated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_memory" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"case_id" varchar,
	"worker_id" varchar,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_id" varchar NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer DEFAULT 0,
	"base64_data" text,
	"is_certificate" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "partner_user_organizations" (
	"user_id" varchar NOT NULL,
	"organization_id" varchar NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by" varchar,
	CONSTRAINT "partner_user_organizations_user_id_organization_id_pk" PRIMARY KEY("user_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "rtw_plan_consents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar NOT NULL,
	"plan_id" varchar,
	"case_id" varchar NOT NULL,
	"consent_status" text DEFAULT 'pending' NOT NULL,
	"conditions" text,
	"refusal_reason" text,
	"method" text DEFAULT 'verbal' NOT NULL,
	"recorded_by" varchar NOT NULL,
	"document_url" text,
	"notes" text,
	"recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "telehealth_bookings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"case_id" varchar,
	"worker_id" varchar,
	"worker_name" text NOT NULL,
	"worker_email" text,
	"employer_name" text,
	"service_type" text,
	"appointment_type" text NOT NULL,
	"employer_notes" text,
	"request_referral" boolean DEFAULT false,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"date_of_birth" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "trigger_condition" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "compliance_rule_code" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "legislative_ref" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "draft_email_content" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "phone_script" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "explanation_json" jsonb;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "priority_level" text DEFAULT 'medium';--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "assigned_role" text;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "cancelled_by" varchar;--> statement-breakpoint
ALTER TABLE "case_actions" ADD COLUMN "cancelled_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "kind" text DEFAULT 'employer' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "abn" varchar(11);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "worksafe_state" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "policy_number" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "wic_code" varchar(20);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line_1" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "address_line_2" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suburb" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "postcode" varchar(4);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "insurer_claim_contact_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rtw_coordinator_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rtw_coordinator_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "rtw_coordinator_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "hr_contact_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "hr_contact_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "hr_contact_phone" varchar(50);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "notification_emails" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "employee_count" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "worker_id" varchar;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "access_token" varchar(64);--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "job_description" text;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "job_description_file_url" text;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "questionnaire_responses" jsonb;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "employer_notified_at" timestamp;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "report_json" jsonb;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD COLUMN "alert_sent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "rtw_plans" ADD COLUMN "pathway" text;--> statement-breakpoint
ALTER TABLE "rtw_plans" ADD COLUMN "pathway_rationale" text;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "worker_id" varchar;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "claim_number" text;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "type" text DEFAULT 'injury' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "assessment_id" varchar;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "case_manager_id" varchar;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "case_manager_name" text;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "secondary_assignee_id" varchar;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "lifecycle_stage" text DEFAULT 'intake' NOT NULL;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "lifecycle_stage_changed_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "lifecycle_stage_changed_by" text;--> statement-breakpoint
ALTER TABLE "worker_cases" ADD COLUMN "lifecycle_stage_reason" text;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_job_id_agent_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."agent_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_jobs" ADD CONSTRAINT "agent_jobs_case_id_worker_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."worker_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_emails" ADD CONSTRAINT "case_emails_case_id_worker_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."worker_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_lifecycle_logs" ADD CONSTRAINT "case_lifecycle_logs_case_id_worker_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."worker_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_case_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."case_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_user_organizations" ADD CONSTRAINT "partner_user_organizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_user_organizations" ADD CONSTRAINT "partner_user_organizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_user_organizations" ADD CONSTRAINT "partner_user_organizations_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rtw_plan_consents" ADD CONSTRAINT "rtw_plan_consents_plan_id_rtw_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rtw_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rtw_plan_consents" ADD CONSTRAINT "rtw_plan_consents_case_id_worker_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."worker_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rtw_plan_consents" ADD CONSTRAINT "rtw_plan_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_bookings" ADD CONSTRAINT "telehealth_bookings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telehealth_bookings" ADD CONSTRAINT "telehealth_bookings_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_user_organizations_user_id_idx" ON "partner_user_organizations" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD CONSTRAINT "pre_employment_assessments_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pre_employment_assessments" ADD CONSTRAINT "pre_employment_assessments_access_token_unique" UNIQUE("access_token");