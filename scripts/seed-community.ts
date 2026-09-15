import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import fs from "node:fs";
import { widgetProjectConfigSchema } from "../packages/shared/src/index";
async function main() {
const db = new PrismaClient();
try {
  const existing = await db.project.findFirst();
  if (existing) { console.log("Existing Community project preserved."); }
  else {
    const secret = `tgws_${crypto.randomBytes(32).toString("hex")}`;
    const email = process.env.ADMIN_SEED_EMAIL!;
    const passwordHash = await bcrypt.hash(process.env.ADMIN_SEED_PASSWORD!, 10);
    await db.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name: "Community", slug: "community" } });
      const user = await tx.adminUser.create({ data: { email, name: process.env.ADMIN_SEED_NAME!, passwordHash, role: "ADMIN" } });
      const project = await tx.project.create({ data: { organizationId: organization.id, key: "community", name: "Community", description: "Your project", defaultEnvironment: "development", allowedOrigins: [process.env.DEMO_APP_URL!], notificationEmails: [email], widgetClientSecretHash: crypto.createHash("sha256").update(secret).digest("hex"), widgetClientSecretRotatedAt: new Date(), widgetConfig: widgetProjectConfigSchema.parse({ surveyPrompt: { enabled: false } }) } });
      await tx.orgMembership.create({ data: { organizationId: organization.id, userId: user.id, role: "OWNER" } });
      await tx.projectMembership.create({ data: { projectId: project.id, userId: user.id, role: "PROJECT_ADMIN" } });
    });
    fs.writeFileSync(".local/widget-secret.txt",secret+"\n",{mode:0o600});
    console.log("Created the one Community project and local administrator.");
  }
} finally { await db.$disconnect(); }

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
