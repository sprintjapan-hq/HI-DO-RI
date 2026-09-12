import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Clock3, History } from "lucide-react";
import { Link } from "wouter";

import { Layout } from "@/components/layout";
import {
  toReleaseCard,
  type PublishedRelease,
  type ReleaseCard,
} from "@/lib/release-history";

const releases: ReleaseCard[] = [
  {
    version: "v0.5",
    date: "2026年9月7日",
    time: "19:27",
    title: "Googleカレンダー連携の日程調整フローを完成",
    features: [
      "指定期間・曜日・時間帯・所要時間を組み合わせた日本語条件から候補日時を生成",
      "接続した主催者のデフォルトカレンダーを参照し、予定と重なる候補を除外",
      "出欠表の作成時、採用したすべての候補日時をGoogleカレンダーへ仮予定として登録",
      "開催日の確定時、候補の仮予定をすべて削除して確定日時だけを正式予定として登録",
      "Googleの一時障害から自動復旧し、再試行しても予定が重複しないよう改善",
      "Googleの権限切れを検知し、一般エラーではなく再接続案内を表示",
    ],
  },
  {
    version: "v0.4",
    date: "2026年9月5日",
    time: "11:35",
    title: "Googleカレンダー連携と候補日の自動生成",
    features: [
      "主催者のGoogleカレンダーから予定の入っていない時間を確認",
      "「平日の夜7時以降で2時間」のような日本語条件から候補日を自動生成",
      "開催日確定後にGoogleカレンダーへ予定を登録",
      "開発工程の節目と完了を運営用Slackチャンネルへ通知",
      "完了時のリリース情報を機能追加履歴へ自動掲載",
    ],
  },
  {
    version: "v0.3",
    date: "2026年9月4日",
    time: "12:45",
    title: "ご要望受付と機能追加履歴を公開",
    features: [
      "追加機能リクエスト・相談フォームを追加",
      "送信されたご要望をSlackへ通知",
      "Slackが一時停止しても受付内容が失われない保存・再通知機能を追加",
      "未通知のリクエストを運営者が確認できる管理機能を追加",
      "機能追加履歴ページを新設",
      "全画面のフッターからリクエストと履歴ページへ移動できるリンクを追加",
    ],
  },
  {
    version: "v0.2",
    date: "2026年9月4日",
    time: "10:22",
    title: "主催者向けイベント管理を強化",
    features: [
      "主催者アカウントに紐づくマイページを追加",
      "作成したイベントを別の端末から確認できるイベント履歴を追加",
      "イベントのタイトルと詳細文を編集できる機能を追加",
      "既存の回答を保持したまま候補日を追加できる機能を追加",
      "主催者本人は共有URLからイベントを管理できるように改善",
      "回答確認から編集・開催日確定へ進みやすいよう主催者メニューを画面下部へ移動",
    ],
  },
  {
    version: "v0.1",
    date: "2026年9月3日",
    time: "23:51",
    title: "HI-DO-RI 初回リリース",
    features: [
      "主催者が候補日を登録して日程調整イベントを作成",
      "共有URLを知っている参加者がログインなしで○・△・×を回答",
      "参加者全員の回答状況を一覧で確認",
      "主催者による開催日の確定",
      "回答期限の設定と、期限終了後の回答受付停止",
      "ライトモード・ダークモードの切り替え",
    ],
  },
];

export default function FeatureHistory() {
  const [automaticReleases, setAutomaticReleases] = useState<ReleaseCard[]>([]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "機能追加履歴 | HI-DO-RI";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/feature-requests/releases", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : [])
      .then((items: PublishedRelease[]) => setAutomaticReleases(items.map(toReleaseCard)))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("リリース情報を取得できませんでした", error);
      });
    return () => controller.abort();
  }, []);

  return (
    <Layout>
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          トップへ戻る
        </Link>

        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <History className="h-3.5 w-3.5" />
            Release notes
          </div>
          <h1 className="font-serif text-3xl font-bold sm:text-4xl">機能追加履歴</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
            HI-DO-RIに追加された機能や改善内容をお知らせします。
          </p>
        </div>

        <div className="space-y-6">
          {[...automaticReleases, ...releases].map((release) => (
            <article key={release.version} className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-xl shadow-black/5">
              <div className="border-b border-border/70 bg-primary/5 p-6 sm:p-8">
                <div className="flex items-center justify-between gap-4">
                  <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold tracking-wider text-primary-foreground">
                    {release.version}
                  </span>
                  <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {release.date}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="h-3.5 w-3.5" />
                      {release.time}
                    </span>
                  </div>
                </div>
                <h2 className="mt-5 font-serif text-2xl font-bold">{release.title}</h2>
              </div>

              <div className="p-6 sm:p-8">
                <ul className="space-y-3">
                  {release.features.map((feature) => (
                    <li key={feature} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
                      <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </div>
    </Layout>
  );
}