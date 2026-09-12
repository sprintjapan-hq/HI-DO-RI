import { Router, type IRouter, type Response } from "express";
import { randomUUID } from "node:crypto";
import { getAuth } from "@clerk/express";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  CreateFeatureRequestBody,
  CreateFeatureRequestResponse,
  ListFeatureRequestDevelopmentResponse,
  UpdateFeatureRequestDevelopmentStatusBody,
  UpdateFeatureRequestDevelopmentStatusResponse,
} from "@workspace/api-zod";
import { db, featureRequestsTable } from "@workspace/db";
import {
  notifyFeatureRequest,
  notifyFeatureRequestDevelopmentStatus,
  scheduleFeatureRequestRetry,
} from "../lib/feature-request-notifications";

const router: IRouter = Router();
const recentRequests = new Map<string, number[]>();
let developmentOperatorUserId: string | null = null;
const nextDevelopmentStatus = {
  received: "approved",
  approved: "in_progress",
  in_progress: "validating",
  validating: "preview_ready",
  preview_ready: "completed",
  completed: null,
} as const;

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

router.get("/feature-requests/notifications/pending", async (req, res): Promise<void> => {
  if (!requireOperator(req, res)) return;

  const requestedLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 100)
    : 50;

  try {
    const [requests, countRows] = await Promise.all([
      db
        .select({
          id: featureRequestsTable.id,
          name: featureRequestsTable.name,
          contact: featureRequestsTable.contact,
          request: featureRequestsTable.request,
          useCase: featureRequestsTable.useCase,
          notificationStatus: featureRequestsTable.notificationStatus,
          notificationAttempts: featureRequestsTable.notificationAttempts,
          notificationError: featureRequestsTable.notificationError,
          nextNotificationAttemptAt: featureRequestsTable.nextNotificationAttemptAt,
          createdAt: featureRequestsTable.createdAt,
        })
        .from(featureRequestsTable)
        .where(inArray(featureRequestsTable.notificationStatus, ["pending", "failed"]))
        .orderBy(desc(featureRequestsTable.createdAt))
        .limit(limit),
      db
        .select({ count: sql<number>`count(*)` })
        .from(featureRequestsTable)
        .where(inArray(featureRequestsTable.notificationStatus, ["pending", "failed"])),
    ]);

    res.json({ total: Number(countRows[0]?.count ?? 0), requests });
  } catch (error) {
    req.log.error({ err: error }, "Pending feature requests could not be listed");
    res.status(500).json({ error: "未通知の受付を取得できませんでした。" });
  }
});

router.get("/feature-requests/development", async (req, res): Promise<void> => {
  if (!requireOperator(req, res)) return;
  const requests = await db
    .select({
      id: featureRequestsTable.id,
      name: featureRequestsTable.name,
      request: featureRequestsTable.request,
      useCase: featureRequestsTable.useCase,
      notificationStatus: featureRequestsTable.notificationStatus,
      developmentStatus: featureRequestsTable.developmentStatus,
      developmentNote: featureRequestsTable.developmentNote,
      createdAt: featureRequestsTable.createdAt,
      developmentStatusUpdatedAt: featureRequestsTable.developmentStatusUpdatedAt,
      completedAt: featureRequestsTable.completedAt,
    })
    .from(featureRequestsTable)
    .orderBy(desc(featureRequestsTable.createdAt))
    .limit(100);
  res.json(ListFeatureRequestDevelopmentResponse.parse(requests));
});

router.get("/feature-requests/releases", async (_req, res): Promise<void> => {
  const releases = await db
    .select({
      id: featureRequestsTable.id,
      note: featureRequestsTable.developmentNote,
      completedAt: featureRequestsTable.completedAt,
    })
    .from(featureRequestsTable)
    .where(and(
      eq(featureRequestsTable.developmentStatus, "completed"),
      isNotNull(featureRequestsTable.developmentNote),
      isNotNull(featureRequestsTable.completedAt),
    ))
    .orderBy(desc(featureRequestsTable.completedAt))
    .limit(50);

  res.json(releases.filter((release) => release.note?.trim()));
});

router.post("/feature-requests/:id/development-status", async (req, res): Promise<void> => {
  const operatorUserId = requireOperator(req, res);
  if (!operatorUserId) return;
  const id = Number.parseInt(req.params.id, 10);
  const body = UpdateFeatureRequestDevelopmentStatusBody.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !body.success || body.data.status === "received") {
    res.status(400).json({ error: "進捗内容が正しくありません。" });
    return;
  }
  if (body.data.status === "completed" && !body.data.note?.trim()) {
    res.status(400).json({ error: "完了時は、機能履歴に公開するリリース情報を入力してください。" });
    return;
  }
  const [existing] = await db.select().from(featureRequestsTable).where(eq(featureRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "機能リクエストが見つかりません。" });
    return;
  }
  if (existing.developmentStatus === body.data.status) {
    res.status(409).json({ error: "この進捗はすでに通知済みです。" });
    return;
  }
  if (nextDevelopmentStatus[existing.developmentStatus] !== body.data.status) {
    res.status(409).json({ error: "進捗は順番に更新してください。" });
    return;
  }
  try {
    await notifyFeatureRequestDevelopmentStatus(existing, body.data.status, body.data.note);
  } catch (error) {
    req.log.error({ err: error, featureRequestId: id }, "Development status Slack notification failed");
    res.status(502).json({ error: "Slackへ進捗を送信できなかったため、記録は変更していません。" });
    return;
  }
  const now = new Date();
  const [updated] = await db
    .update(featureRequestsTable)
    .set({
      developmentStatus: body.data.status,
      developmentNote: body.data.note || null,
      developmentStatusUpdatedAt: now,
      completedAt: body.data.status === "completed" ? now : null,
      completedBy: body.data.status === "completed" ? operatorUserId : null,
      updatedAt: now,
    })
    .where(and(eq(featureRequestsTable.id, id), eq(featureRequestsTable.developmentStatus, existing.developmentStatus)))
    .returning({
      id: featureRequestsTable.id,
      name: featureRequestsTable.name,
      request: featureRequestsTable.request,
      useCase: featureRequestsTable.useCase,
      notificationStatus: featureRequestsTable.notificationStatus,
      developmentStatus: featureRequestsTable.developmentStatus,
      developmentNote: featureRequestsTable.developmentNote,
      createdAt: featureRequestsTable.createdAt,
      developmentStatusUpdatedAt: featureRequestsTable.developmentStatusUpdatedAt,
      completedAt: featureRequestsTable.completedAt,
    });
  if (!updated) {
    res.status(409).json({ error: "別の進捗更新と重なりました。再読み込みしてください。" });
    return;
  }
  res.json(UpdateFeatureRequestDevelopmentStatusResponse.parse(updated));
});

router.post("/feature-requests/:id/retry-notification", async (req, res): Promise<void> => {
  if (!requireOperator(req, res)) return;

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "受付IDが不正です。" });
    return;
  }

  try {
    if (await scheduleFeatureRequestRetry(id)) {
      res.status(202).json({ success: true });
      return;
    }

    const [existing] = await db
      .select({ notificationStatus: featureRequestsTable.notificationStatus })
      .from(featureRequestsTable)
      .where(eq(featureRequestsTable.id, id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "受付が見つかりません。" });
      return;
    }
    res.status(409).json({
      error:
        existing.notificationStatus === "sent"
          ? "この受付は通知済みです。"
          : "この受付は現在送信中です。",
    });
  } catch (error) {
    req.log.error({ err: error, featureRequestId: id }, "Feature request retry could not be scheduled");
    res.status(500).json({ error: "再送を開始できませんでした。" });
  }
});

router.post("/feature-requests", async (req, res): Promise<void> => {
  const parsed = CreateFeatureRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "入力内容を確認してください。" });
    return;
  }

  const key = req.ip ?? "unknown";
  const now = Date.now();
  const attempts = (recentRequests.get(key) ?? []).filter(
    (timestamp) => now - timestamp < 60 * 60 * 1000,
  );
  if (attempts.length >= 5) {
    res.status(429).json({ error: "送信回数が多すぎます。時間をおいてお試しください。" });
    return;
  }

  const { name, contact, request, useCase } = parsed.data;

  try {
    const [saved] = await db
      .insert(featureRequestsTable)
      .values({
        notificationKey: randomUUID(),
        name,
        contact: contact || null,
        request,
        useCase: useCase || null,
      })
      .returning({ id: featureRequestsTable.id });

    recentRequests.set(key, [...attempts, now]);
    res.status(201).json(CreateFeatureRequestResponse.parse({ success: true }));

    void notifyFeatureRequest(saved.id).catch((error) => {
      req.log.error(
        { err: error, featureRequestId: saved.id },
        "Feature request notification attempt failed",
      );
    });
  } catch (error) {
    req.log.error({ err: error }, "Feature request could not be saved");
    res.status(500).json({ error: "受付できませんでした。時間をおいてお試しください。" });
  }
});

export default router;