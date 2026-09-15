CREATE TABLE "email_settings" (
  "id" TEXT PRIMARY KEY DEFAULT 'community' CHECK ("id" = 'community'),
  "provider" TEXT NOT NULL CHECK ("provider" IN ('resend', 'smtp')),
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL CHECK ("port" BETWEEN 1 AND 65535),
  "secure" BOOLEAN NOT NULL,
  "user" TEXT NOT NULL,
  "credential_encrypted" TEXT,
  "from_name" TEXT NOT NULL,
  "from_email" TEXT NOT NULL,
  "reply_to" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "last_test_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL
);
