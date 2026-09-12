import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import {
  db,
  pollCandidatesTable,
  pollResponsesTable,
  pollsTable,
} from "@workspace/db";
import {
  createTentativePollEvents,
  GOOGLE_CALENDAR_RECONNECT_ERROR_CODE,
  synchronizePollCalendarEvents,
} from "../lib/google-calendar";
import {
  CreatePollBody,
  CreatePollResponse,
  CreatePollResponseBody,
  CreatePollResponseParams,
  CreatePollResponseResponse,
  ConfirmPollBody,
  ConfirmPollParams,
  ConfirmPollResponse,
  GetPollParams,
  GetPollResponse,
  ListOrganizerPollsResponse,
  ClaimLegacyPollBody,
  ClaimLegacyPollParams,
  ClaimLegacyPollResponse,
  UpdatePollBody,
  UpdatePollParams,
  UpdatePollResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const MAX_POLLS_PER_24_HOURS = 10;
const LEGACY_CLAIM_SHARE_ID =
  process.env.NODE_ENV === "test" ? "legacy-test-poll" : "ml73WmEq";
const LEGACY_CLAIM_TOKEN_HASH =
  process.env.NODE_ENV === "test"
    ? "2cff2620cbbc3705935ca395a6a0fab528a86f2074048fcf24e4aeef5721857d"
    : "32d94a8fe0a46fdf26334fa22c51f7356072ba2a814c82dc538e981de83d2dd7";

function isValidLegacyClaimToken(token: string) {
  const actual = Buffer.from(createHash("sha256").update(token).digest("hex"));
  const expected = Buffer.from(LEGACY_CLAIM_TOKEN_HASH);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function getRequestUserId(req: Parameters<typeof getAuth>[0]) {
  if (process.env.NODE_ENV === "test") {
    return req.header("X-Test-User-Id") ?? null;
  }
  return getAuth(req).userId;
}

async function buildPoll(shareId: string, viewerUserId?: string | null) {
  const [poll] = await db
    .select()
    .from(pollsTable)
    .where(eq(pollsTable.shareId, shareId))
    .limit(1);

  if (!poll) return null;

  const [candidates, responses] = await Promise.all([
    db
      .select()
      .from(pollCandidatesTable)
      .where(eq(pollCandidatesTable.pollId, poll.id))
      .orderBy(asc(pollCandidatesTable.position)),
    db
      .select()
      .from(pollResponsesTable)
      .where(eq(pollResponsesTable.pollId, poll.id))
      .orderBy(asc(pollResponsesTable.createdAt)),
  ]);

  return {
    id: poll.id,
    shareId: poll.shareId,
    title: poll.title,
    note: poll.note,
    deadline: poll.deadline,
    isClosed:
      poll.confirmedCandidateId !== null ||
      (poll.deadline !== null && poll.deadline.getTime() <= Date.now()),
    confirmedCandidateId: poll.confirmedCandidateId,
    canManage: !!viewerUserId && poll.ownerUserId === viewerUserId,
    createdAt: poll.createdAt,
    candidates: candidates.map((candidate, index) => ({
      id: candidate.id,
      label: candidate.label,
      start: candidate.startAt,
      end: candidate.endAt,
      yesCount: responses.filter((response) => response.answers[index] === "yes").length,
      maybeCount: responses.filter((response) => response.answers[index] === "maybe").length,
      noCount: responses.filter((response) => response.answers[index] === "no").length,
    })),
    responses: responses.map((response) => ({
      id: response.id,
      name: response.name,
      answers: response.answers,
      comment: response.comment,
      createdAt: response.createdAt,
    })),
  };
}

router.post("/polls", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "イベント作成にはログインが必要です。" });
    return;
  }

  const recentPolls = await db
    .select({ count: sql<number>`count(*)` })
    .from(pollsTable)
    .where(
      and(
        eq(pollsTable.ownerUserId, userId),
        gte(pollsTable.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  if (Number(recentPolls[0]?.count ?? 0) >= MAX_POLLS_PER_24_HOURS) {
    res.status(429).json({ error: "イベント作成は24時間に10件までです。" });
    return;
  }

  const parsed = CreatePollBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid poll input");
    res.status(400).json({ error: "入力内容を確認してください。" });
    return;
  }

  const title = parsed.data.title.trim();
  const candidates = parsed.data.candidates.map((candidate) => candidate.trim()).filter(Boolean);
  const candidateSlots = new Map((parsed.data.candidateSlots ?? []).flatMap((slot) => {
    const start = new Date(slot.start);
    const end = new Date(slot.end);
    return end > start ? [[slot.label.trim(), { start, end }] as const] : [];
  }));
  if (!title || candidates.length < 2) {
    res.status(400).json({ error: "イベント名と2件以上の候補日を入力してください。" });
    return;
  }

  const shareId = randomBytes(6).toString("base64url");
  const adminKey = randomBytes(24).toString("base64url");
  const createdPoll = await db.transaction(async (tx) => {
    const [poll] = await tx
      .insert(pollsTable)
      .values({
        shareId,
        adminKey,
        ownerUserId: userId,
        title,
        note: parsed.data.note?.trim() ?? "",
        deadline: parsed.data.deadline ? new Date(parsed.data.deadline) : null,
      })
      .returning();
    await tx.insert(pollCandidatesTable).values(
      candidates.map((label, position) => {
        const slot = candidateSlots.get(label);
        return {
          pollId: poll.id,
          label,
          startAt: slot?.start ?? null,
          endAt: slot?.end ?? null,
          position,
        };
      }),
    );
    return poll;
  });

  const shareUrl = `${req.protocol}://${req.get("host")}/p/${encodeURIComponent(shareId)}`;
  try {
    await createTentativePollEvents({
      pollId: createdPoll.id,
      ownerUserId: userId,
      shareUrl,
    });
  } catch (error) {
    req.log.error(
      { err: error, pollId: createdPoll.id },
      "Tentative Google Calendar events could not be synchronized",
    );
  }
  const created = await buildPoll(shareId, userId);
  res.status(201).json(CreatePollResponse.parse({ ...created, adminKey }));
});

router.get("/polls", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "イベント履歴の確認にはログインが必要です。" });
    return;
  }

  const ownedPolls = await db
    .select({
      shareId: pollsTable.shareId,
      title: pollsTable.title,
      note: pollsTable.note,
      deadline: pollsTable.deadline,
      confirmedCandidateId: pollsTable.confirmedCandidateId,
      createdAt: pollsTable.createdAt,
      responseCount: sql<number>`count(${pollResponsesTable.id})`,
    })
    .from(pollsTable)
    .leftJoin(pollResponsesTable, eq(pollResponsesTable.pollId, pollsTable.id))
    .where(eq(pollsTable.ownerUserId, userId))
    .groupBy(pollsTable.id)
    .orderBy(desc(pollsTable.createdAt));

  res.json(
    ListOrganizerPollsResponse.parse(
      ownedPolls.map((poll) => ({
        shareId: poll.shareId,
        title: poll.title,
        note: poll.note,
        deadline: poll.deadline,
        createdAt: poll.createdAt,
        responseCount: Number(poll.responseCount),
        isClosed:
          poll.confirmedCandidateId !== null ||
          (poll.deadline !== null && poll.deadline.getTime() <= Date.now()),
      })),
    ),
  );
});

router.get("/polls/:shareId", async (req, res): Promise<void> => {
  const params = GetPollParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "共有URLが正しくありません。" });
    return;
  }

  const poll = await buildPoll(params.data.shareId, getRequestUserId(req));
  if (!poll) {
    res.status(404).json({ error: "イベントが見つかりません。" });
    return;
  }

  res.json(GetPollResponse.parse(poll));
});

router.post("/polls/:shareId/legacy-claim", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "イベントの引き継ぎにはログインが必要です。" });
    return;
  }

  const params = ClaimLegacyPollParams.safeParse(req.params);
  const body = ClaimLegacyPollBody.safeParse(req.body);
  if (!params.success || !body.success || params.data.shareId !== LEGACY_CLAIM_SHARE_ID) {
    res.status(400).json({ error: "引き継ぎリンクが正しくありません。" });
    return;
  }
  if (!isValidLegacyClaimToken(body.data.claimToken)) {
    res.status(403).json({ error: "引き継ぎリンクが正しくありません。" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [poll] = await tx
      .select()
      .from(pollsTable)
      .where(eq(pollsTable.shareId, params.data.shareId))
      .limit(1)
      .for("update");
    if (!poll) return { status: 404, error: "イベントが見つかりません。" } as const;
    if (poll.ownerUserId === userId) return { status: 200 } as const;
    if (poll.ownerUserId !== null || poll.adminKey !== null) {
      return { status: 409, error: "このイベントはすでに別のアカウントへ引き継がれています。" } as const;
    }

    await tx
      .update(pollsTable)
      .set({ ownerUserId: userId })
      .where(eq(pollsTable.id, poll.id));
    return { status: 200 } as const;
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const claimed = await buildPoll(params.data.shareId, userId);
  res.status(200).json(ClaimLegacyPollResponse.parse(claimed));
});

router.patch("/polls/:shareId", async (req, res): Promise<void> => {
  const userId = getRequestUserId(req);
  if (!userId) {
    res.status(401).json({ error: "イベントの編集にはログインが必要です。" });
    return;
  }

  const params = UpdatePollParams.safeParse(req.params);
  const body = UpdatePollBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "編集内容を確認してください。" });
    return;
  }

  const title = body.data.title.trim();
  const note = body.data.note.trim();
  const newCandidates = body.data.newCandidates.map((candidate) => candidate.trim()).filter(Boolean);
  if (!title) {
    res.status(400).json({ error: "イベント名を入力してください。" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [poll] = await tx
      .select()
      .from(pollsTable)
      .where(eq(pollsTable.shareId, params.data.shareId))
      .limit(1)
      .for("update");
    if (!poll) return { status: 404, error: "イベントが見つかりません。" } as const;
    if (poll.ownerUserId !== userId) {
      return { status: 403, error: "このイベントを編集する権限がありません。" } as const;
    }
    if (
      poll.confirmedCandidateId !== null ||
      (poll.deadline !== null && poll.deadline.getTime() <= Date.now())
    ) {
      return { status: 409, error: "締め切られたイベントは編集できません。" } as const;
    }

    const existingCandidates = await tx
      .select({ id: pollCandidatesTable.id })
      .from(pollCandidatesTable)
      .where(eq(pollCandidatesTable.pollId, poll.id))
      .orderBy(asc(pollCandidatesTable.position));
    if (existingCandidates.length + newCandidates.length > 20) {
      return { status: 400, error: "候補日は合計20件までです。" } as const;
    }

    await tx
      .update(pollsTable)
      .set({ title, note })
      .where(eq(pollsTable.id, poll.id));

    if (newCandidates.length > 0) {
      await tx.insert(pollCandidatesTable).values(
        newCandidates.map((label, index) => ({
          pollId: poll.id,
          label,
          position: existingCandidates.length + index,
        })),
      );
    }

    return { status: 200 } as const;
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const updated = await buildPoll(params.data.shareId, userId);
  res.status(200).json(UpdatePollResponse.parse(updated));
});

router.post("/polls/:shareId/confirmation", async (req, res): Promise<void> => {
  const params = ConfirmPollParams.safeParse(req.params);
  const body = ConfirmPollBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "確定する候補日を確認してください。" });
    return;
  }

  const adminKey = req.header("X-Admin-Key");
  const viewerUserId = getRequestUserId(req);
  if (!adminKey && !viewerUserId) {
    res.status(401).json({ error: "管理URLから操作してください。" });
    return;
  }

  type ConfirmationResult =
    | { status: 200; pollId: number; ownerUserId: string | null }
    | { status: 403 | 404 | 409; error: string };
  const result: ConfirmationResult = await db.transaction(
    async (tx): Promise<ConfirmationResult> => {
    const [poll] = await tx
      .select()
      .from(pollsTable)
      .where(eq(pollsTable.shareId, params.data.shareId))
      .limit(1)
      .for("update");
    if (!poll) return { status: 404, error: "イベントが見つかりません。" } as const;
    if (poll.adminKey !== adminKey && poll.ownerUserId !== viewerUserId) {
      return { status: 403, error: "管理権限がありません。" } as const;
    }
    if (
      poll.confirmedCandidateId !== null ||
      (poll.deadline !== null && poll.deadline.getTime() <= Date.now())
    ) {
      return { status: 409, error: "この出欠表はすでに締め切られています。" } as const;
    }

    const [candidate] = await tx
      .select({ id: pollCandidatesTable.id })
      .from(pollCandidatesTable)
      .where(and(eq(pollCandidatesTable.id, body.data.candidateId), eq(pollCandidatesTable.pollId, poll.id)))
      .limit(1);
    if (!candidate) return { status: 404, error: "候補日が見つかりません。" } as const;

    await tx.update(pollsTable).set({ confirmedCandidateId: candidate.id }).where(eq(pollsTable.id, poll.id));
    return {
      status: 200,
      pollId: poll.id,
      ownerUserId: poll.ownerUserId,
    };
    },
  );
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  let calendarSyncPermanentFailure = false;
  let calendarReconnectRequired = false;
  if (result.ownerUserId) {
    const shareUrl = `${req.protocol}://${req.get("host")}/p/${encodeURIComponent(params.data.shareId)}`;
    try {
      const sync = await synchronizePollCalendarEvents({
        pollId: result.pollId,
        shareUrl,
      });
      calendarSyncPermanentFailure = sync.status === "permanent_failure";
      calendarReconnectRequired = sync.status === "reconnect_required";
    } catch (error) {
      req.log.error(
        { err: error, pollId: result.pollId },
        "Google Calendar events could not be finalized",
      );
    }
  }
  const confirmed = await buildPoll(params.data.shareId, viewerUserId);
  if (calendarReconnectRequired) {
    res.status(409).json({
      error:
        "開催日は確定しましたが、Googleカレンダーの権限が切れています。Googleカレンダーを再接続してください。",
      code: GOOGLE_CALENDAR_RECONNECT_ERROR_CODE,
    });
    return;
  }
  if (calendarSyncPermanentFailure) {
    res.status(502).json({
      error:
        "開催日は確定しましたが、Googleカレンダーを同期できませんでした。接続状態を確認し「Googleカレンダーを確認・再同期」から再試行してください。",
    });
    return;
  }
  res.status(200).json(ConfirmPollResponse.parse(confirmed));
});

router.post("/polls/:shareId/responses", async (req, res): Promise<void> => {
  const params = CreatePollResponseParams.safeParse(req.params);
  const body = CreatePollResponseBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "回答内容を確認してください。" });
    return;
  }

  const name = body.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "お名前を入力してください。" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [poll] = await tx.select().from(pollsTable).where(eq(pollsTable.shareId, params.data.shareId)).limit(1).for("update");
    if (!poll) return { status: 404, error: "イベントが見つかりません。" } as const;
    if (
      poll.confirmedCandidateId !== null ||
      (poll.deadline !== null && poll.deadline.getTime() <= Date.now())
    ) {
      return { status: 409, error: "この出欠表はすでに締め切られています。" } as const;
    }

    const candidates = await tx.select({ id: pollCandidatesTable.id }).from(pollCandidatesTable).where(eq(pollCandidatesTable.pollId, poll.id));
    if (body.data.answers.length !== candidates.length) return { status: 400, error: "すべての候補日に回答してください。" } as const;

    const [existing] = await tx.select({ id: pollResponsesTable.id }).from(pollResponsesTable).where(and(eq(pollResponsesTable.pollId, poll.id), eq(pollResponsesTable.name, name))).limit(1);
    const [saved] = existing
      ? await tx.update(pollResponsesTable).set({ answers: body.data.answers, comment: body.data.comment?.trim() || null, updatedAt: new Date() }).where(eq(pollResponsesTable.id, existing.id)).returning()
      : await tx.insert(pollResponsesTable).values({ pollId: poll.id, name, answers: body.data.answers, comment: body.data.comment?.trim() || null }).returning();
    return { status: 201, saved } as const;
  });
  if (result.status !== 201) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.status(201).json(
    CreatePollResponseResponse.parse({
      id: result.saved.id,
      name: result.saved.name,
      answers: result.saved.answers,
      comment: result.saved.comment,
      createdAt: result.saved.createdAt,
    }),
  );
});

export default router;