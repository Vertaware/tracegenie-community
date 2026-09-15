import { PrismaClient,type Prisma } from "@prisma/client";

type QueryObserver = (event: Prisma.QueryEvent) => void;

const queryObservers = new Set<QueryObserver>();
const queryMetricsEnabled = process.env.TRACEGENIE_QUERY_METRICS === "1";

export const prisma = new PrismaClient(queryMetricsEnabled
  ? { log: [{ emit: "event", level: "query" }] }
  : undefined);

if (queryMetricsEnabled) {
  prisma.$on("query", (event) => {
    for (const observer of queryObservers) observer(event);
  });
}

export function observePrismaQueries(observer: QueryObserver) {
  if (!queryMetricsEnabled) {
    throw new Error("Set TRACEGENIE_QUERY_METRICS=1 before importing Prisma query telemetry.");
  }
  queryObservers.add(observer);
  return () => queryObservers.delete(observer);
}
