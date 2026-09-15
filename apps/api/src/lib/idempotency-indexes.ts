import { AppError } from "./errors";
import { prisma } from "./prisma";

export const feedbackIdempotencyIndexes = [
  {
    name: "feedback_items_project_id_client_submission_id_key",
    table: "feedback_items",
    columns: ["project_id", "client_submission_id"],
  },
  {
    name: "feedback_attachments_project_id_client_upload_id_key",
    table: "feedback_attachments",
    columns: ["project_id", "client_upload_id"],
  },
] as const;

export type FeedbackIdempotencyIndexState = {
  name: string;
  schemaName: string;
  tableName: string;
  tableSchema: string;
  isValid: boolean;
  isReady: boolean;
  isUnique: boolean;
  isNotPartial: boolean;
  columns: string[];
};

export function invalidFeedbackIdempotencyIndexes(rows: FeedbackIdempotencyIndexState[], schemaName: string) {
  return feedbackIdempotencyIndexes.filter((expected) => {
    const row = rows.find((candidate) => candidate.name === expected.name);
    return !row
      || row.schemaName !== schemaName
      || row.tableSchema !== schemaName
      || row.tableName !== expected.table
      || !row.isValid
      || !row.isReady
      || !row.isUnique
      || !row.isNotPartial
      || row.columns.length !== expected.columns.length
      || row.columns.some((column, index) => column !== expected.columns[index]);
  }).map((index) => index.name);
}

export async function assertFeedbackIdempotencyIndexesReady() {
  const schemas = await prisma.$queryRaw<Array<{ schemaName: string }>>`
    SELECT current_schema() AS "schemaName"
  `;
  const schemaName = schemas[0]?.schemaName;
  if (!schemaName) {
    throw new AppError(503, "database.idempotency_indexes_not_ready", "The current database schema could not be resolved.");
  }
  const rows = await prisma.$queryRaw<FeedbackIdempotencyIndexState[]>`
    SELECT index_class.relname AS "name",
           index_namespace.nspname AS "schemaName",
           table_class.relname AS "tableName",
           table_namespace.nspname AS "tableSchema",
           index_meta.indisvalid AS "isValid",
           index_meta.indisready AS "isReady",
           index_meta.indisunique AS "isUnique",
           index_meta.indpred IS NULL AS "isNotPartial",
           array_agg(attribute.attname ORDER BY key.ordinality) AS "columns"
      FROM pg_class index_class
      JOIN pg_namespace index_namespace ON index_namespace.oid = index_class.relnamespace
      JOIN pg_index index_meta ON index_meta.indexrelid = index_class.oid
      JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_class.relnamespace
      JOIN LATERAL unnest(index_meta.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        ON key.ordinality <= index_meta.indnkeyatts
      JOIN pg_attribute attribute
        ON attribute.attrelid = table_class.oid AND attribute.attnum = key.attnum
     WHERE index_namespace.nspname = current_schema()
       AND index_class.relname IN (
         'feedback_items_project_id_client_submission_id_key',
         'feedback_attachments_project_id_client_upload_id_key'
       )
     GROUP BY index_class.relname, index_namespace.nspname, table_class.relname,
              table_namespace.nspname, index_meta.indisvalid, index_meta.indisready,
              index_meta.indisunique, index_meta.indpred
  `;
  const invalid = invalidFeedbackIdempotencyIndexes(rows, schemaName);
  if (invalid.length > 0) {
    throw new AppError(
      503,
      "database.idempotency_indexes_not_ready",
      `Required feedback idempotency indexes are missing or invalid: ${invalid.join(", ")}`,
    );
  }
}
