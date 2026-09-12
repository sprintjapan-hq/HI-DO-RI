import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, featureRequestsTable } from "@workspace/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { logger } from "./logger";

const connectors = new ReplitConnectors();
const RETRY_INTERVAL_MS = 60_000;
const MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const BATCH_SIZE = 10;
const SENDING_TIMEOUT_MS = 10 * 60 * 1000;

type SlackMessage = {
  channel: string;
  text: string;
  client_msg_id: string;
};

type NotificationOptions = {
  now?: Date;
  sendSlackMessage?: (message: SlackMessage) => Promise<void>;
};

function notificationText(
  featureRequest: typeof featureRequestsTable.$inferSelect,
): string {
  return [
    "💡 *HI-DO-RI 機能リクエスト*",
    `*お名前:* ${featureRequest.name}`,
    featureRequest.contact
      ? `*連絡先:* ${featureRequest.contact}`
      : "*連絡先:* 未入力",
    `*欲しい機能・相談内容:*\n${featureRequest.request}`,
    featureRequest.useCase
      ? `*利用場面・困っていること:*\n${featureRequest.useCase}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function retryAt(attempt: number, now: Date): Date {
  const delay = Math.min(2 ** Math.max(0, attempt - 1) * RETRY_INTERVAL_MS, MAX_RETRY_DELAY_MS);
  return new Date(now.getTime() + delay);
}

async function sendSlackMessage(message: SlackMessage): Promise<void> {
  const response = await connectors.proxy("slack", "/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? `Slack returned HTTP ${response.status}`);
  }
}

const developmentStatusLabels = {
  received: "受付済み",
  approved: "仕様承認",
  in_progress: "開発中",
  validating: "検証中",
  preview_ready: "プレビュー準備完了",
  completed: "完了",
} as const;

export async function notifyFeatureRequestDevelopmentStatus(
  featureRequest: typeof featureRequestsTable.$inferSelect,
  status: keyof typeof developmentStatusLabels,
  note?: string | null,
): Promise<void> {
  const channel = process.env.FEATURE_REQUEST_SLACK_CHANNEL_ID;
  if (!channel) {
    throw new Error("Feature request Slack channel is not configured");
  }
  await sendSlackMessage({
    channel,
    client_msg_id: `hidori-development-${featureRequest.id}-${status}`,
    text: [
      "🚧 *HI-DO-RI 開発状況*",
      `*機能リクエスト:* ${featureRequest.request}`,
      `*状況:* ${developmentStatusLabels[status]}`,
      note ? `*メモ:*\n${note}` : null,
      status === "completed" ? "*記録:* 完了通知ボタンから確定" : null,
    ].filter(Boolean).join("\n\n"),
  });
}

export async function notifyFeatureRequest(
  id: number,
  options: NotificationOptions = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const [claimed] = await db
    .update(featureRequestsTable)
    .set({
      notificationStatus: "sending",
      notificationAttempts: sql`${featureRequestsTable.notificationAttempts} + 1`,
      notificationError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(featureRequestsTable.id, id),
        inArray(featureRequestsTable.notificationStatus, ["pending", "failed"]),
        lte(featureRequestsTable.nextNotificationAttemptAt, now),
      ),
    )
    .returning();

  if (!claimed) {
    return false;
  }

  try {
    const channel = process.env.FEATURE_REQUEST_SLACK_CHANNEL_ID;
    if (!channel) {
      throw new Error("Feature request Slack channel is not configured");
    }

    await (options.sendSlackMessage ?? sendSlackMessage)({
      channel,
      text: notificationText(claimed),
      client_msg_id: claimed.notificationKey,
    });

    await db
      .update(featureRequestsTable)
      .set({
        notificationStatus: "sent",
        notificationError: null,
        notifiedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(featureRequestsTable.id, id),
          eq(featureRequestsTable.notificationStatus, "sending"),
        ),
      );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Slack error";
    await db
      .update(featureRequestsTable)
      .set({
        notificationStatus: "failed",
        notificationError: message.slice(0, 2_000),
        nextNotificationAttemptAt: retryAt(claimed.notificationAttempts, now),
        updatedAt: now,
      })
      .where(
        and(
          eq(featureRequestsTable.id, id),
          eq(featureRequestsTable.notificationStatus, "sending"),
        ),
      );
    logger.error({ err: error, featureRequestId: id }, "Slack notification failed");
    return false;
  }
}

export async function scheduleFeatureRequestRetry(id: number): Promise<boolean> {
  const [scheduled] = await db
    .update(featureRequestsTable)
    .set({
      nextNotificationAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(featureRequestsTable.id, id),
        inArray(featureRequestsTable.notificationStatus, ["pending", "failed"]),
      ),
    )
    .returning({ id: featureRequestsTable.id });

  if (!scheduled) {
    return false;
  }

  void notifyFeatureRequest(id).catch((error) => {
    logger.error({ err: error, featureRequestId: id }, "Manual notification retry failed");
  });
  return true;
}
export async function retryDueNotifications(
  options: NotificationOptions = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await db
    .update(featureRequestsTable)
    .set({
      notificationStatus: "failed",
      notificationError: "Notification attempt timed out",
      nextNotificationAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(featureRequestsTable.notificationStatus, "sending"),
        lte(
          featureRequestsTable.updatedAt,
          new Date(now.getTime() - SENDING_TIMEOUT_MS),
        ),
      ),
    );

  const due = await db
    .select({ id: featureRequestsTable.id })
    .from(featureRequestsTable)
    .where(
      and(
        inArray(featureRequestsTable.notificationStatus, ["pending", "failed"]),
        lte(featureRequestsTable.nextNotificationAttemptAt, now),
      ),
    )
    .limit(BATCH_SIZE);

  await Promise.all(
    due.map(({ id }) => notifyFeatureRequest(id, { ...options, now })),
  );
}

export function startFeatureRequestNotificationWorker(): NodeJS.Timeout {
  void retryDueNotifications().catch((error) => {
    logger.error({ err: error }, "Feature request retry worker failed");
  });
  const timer = setInterval(() => {
    void retryDueNotifications().catch((error) => {
      logger.error({ err: error }, "Feature request retry worker failed");
    });
  }, RETRY_INTERVAL_MS);
  timer.unref();
  return timer;
}
