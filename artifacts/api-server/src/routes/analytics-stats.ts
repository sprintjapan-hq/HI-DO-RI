import { Router, type IRouter, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, analyticsEventsTable } from "@workspace/db";
import { sql, and, ne, isNotNull } from "drizzle-orm";

const router: IRouter = Router();

let developmentOperatorUserId: string | null = null;

function getRequestUserId(req: Parameters<typeof getAuth>[0]) {
  if (process.env.NODE_ENV === "test") {
    return req.header("X-Test-User-Id") ?? null;
  }
  return getAuth(req).userId;
}

function requireOperator(req: Parameters<typeof getAuth>[0], res: Response) {
  const userId = getRequestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "ログインが必要です。" });
    return null;
  }

  const operatorUserIds = new Set(
    (process.env.OPERATOR_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (operatorUserIds.size === 0 && process.env.NODE_ENV !== "production") {
    developmentOperatorUserId ??= userId;
    if (developmentOperatorUserId === userId) return userId;
  }
  if (!operatorUserIds.has(userId)) {
    res.status(403).json({ error: "運営者権限が必要です。" });
    return null;
  }
  return userId;
}

router.get("/analytics/stats", async (req, res): Promise<void> => {
  if (!requireOperator(req, res)) return;

  try {
    const excludeVerify = req.query.excludeVerify !== "false";
    
    const whereClause = excludeVerify
      ? ne(analyticsEventsTable.utmCampaign, "hd-verify")
      : undefined;

    const eventCounts = await db
      .select({
        event: analyticsEventsTable.event,
        utmSource: analyticsEventsTable.utmSource,
        utmCampaign: analyticsEventsTable.utmCampaign,
        utmContent: analyticsEventsTable.utmContent,
        count: sql<number>`count(*)::int`,
      })
      .from(analyticsEventsTable)
      .where(whereClause)
      .groupBy(
        analyticsEventsTable.event,
        analyticsEventsTable.utmSource,
        analyticsEventsTable.utmCampaign,
        analyticsEventsTable.utmContent
      )
      .orderBy(sql`count(*) desc`);

    const firstEventTime = await db
      .select({ createdAt: analyticsEventsTable.createdAt })
      .from(analyticsEventsTable)
      .orderBy(analyticsEventsTable.createdAt)
      .limit(1);

    res.json({
      eventCounts,
      trackingStartedAt: firstEventTime[0]?.createdAt ?? null,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to fetch analytics stats");
    res.status(500).json({ error: "統計の取得に失敗しました。" });
  }
});

export default router;
