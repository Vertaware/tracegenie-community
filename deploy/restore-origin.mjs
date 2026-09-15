import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  const oldOrigin = process.argv[2];
  const newOrigin = new URL(process.env.PUBLIC_URL).origin;
  const project = await db.project.findFirst();
  if (project && oldOrigin !== newOrigin && project.allowedOrigins.includes(oldOrigin)) {
    await db.project.update({ where: { id: project.id }, data: { allowedOrigins: [...new Set(project.allowedOrigins.map(origin => origin === oldOrigin ? newOrigin : origin))] } });
  }
} finally { await db.$disconnect(); }
