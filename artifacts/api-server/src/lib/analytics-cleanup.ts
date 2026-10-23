import { sql } from "drizzle-orm";
import { db, analyticsEventsTable } from "@workspace/db";
import { logger } from "./logger";

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
const RETENTION_MONTHS = 12;

async function cleanupOldAnalytics(): Promise<void> {
  try {
    const retentionDate = new Date();
    retentionDate.setMonth(retentionDate.getMonth() - RETENTION_MONTHS);
    
    const result = await db
      .delete(analyticsEventsTable)
      .where(sql`${analyticsEventsTable.createdAt} < ${retentionDate}`)
      .returning({ id: analyticsEventsTable.id });
    
    if (result.length > 0) {
      logger.info({ deletedCount: result.length }, "Cleaned up old analytics events");
    }
  } catch (error) {
    logger.error({ err: error }, "Analytics cleanup failed");
  }
}

export function startAnalyticsCleanupWorker(): void {
  setInterval(() => {
    void cleanupOldAnalytics();
  }, CLEANUP_INTERVAL_MS);
  
  void cleanupOldAnalytics();
}
