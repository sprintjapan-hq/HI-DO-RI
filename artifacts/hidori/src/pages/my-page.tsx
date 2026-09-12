import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { Copy, Plus, AlertCircle, Calendar, CalendarClock, ExternalLink, Loader2, SearchX, Check, Pencil } from "lucide-react";
import { getListOrganizerPollsQueryKey, useListOrganizerPolls } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/events";
import { toast } from "sonner";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function CopyLinkButton({ shareId }: { shareId: string }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}${basePath}/p/${shareId}`;

  const handleCopy = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(shareUrl).then(() => {
      toast.success("共有リンクをコピーしました");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      toast.error("コピーに失敗しました");
    });
  };

  return (
    <Button 
      variant="outline" 
      size="sm" 
      onClick={handleCopy}
      className="h-9 gap-1.5 px-3 bg-background/50 hover:bg-muted font-medium transition-colors sm:w-full"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
      <span className={copied ? "text-green-600 dark:text-green-400" : "text-foreground"}>
        {copied ? "コピー完了" : "リンクをコピー"}
      </span>
    </Button>
  );
}

export default function MyPage() {
  const { user } = useUser();
  const { data: polls, isLoading, isError, refetch } = useListOrganizerPolls({
    query: {
      enabled: !!user,
      queryKey: [...getListOrganizerPollsQueryKey(), user?.id],
      refetchInterval: 30_000,
    },
  });

  return (
    <Layout>
      <div className="w-full max-w-3xl mx-auto">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 pb-6 border-b border-border/40">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Dashboard</p>
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-foreground">マイページ</h1>
            <p className="text-sm text-muted-foreground mt-2">作成したイベントの管理と回答状況の確認</p>
          </div>
          <Button asChild className="font-bold shadow-sm shrink-0">
            <Link href="/manage">
              <Plus className="w-4 h-4 mr-1.5" />
              新規作成
            </Link>
          </Button>
        </header>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-primary/40 mb-4" />
            <p className="text-sm text-muted-foreground font-medium animate-pulse">イベントを読み込み中...</p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-destructive/20 rounded-xl bg-destructive/5">
            <AlertCircle className="w-10 h-10 text-destructive/80 mb-4" />
            <h2 className="text-lg font-bold text-destructive mb-2">データの取得に失敗しました</h2>
            <p className="text-sm text-destructive/80 mb-6 max-w-sm">
              イベント一覧を読み込めませんでした。通信環境を確認して、再度お試しください。
            </p>
            <Button onClick={() => refetch()} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10">
              再読み込み
            </Button>
          </div>
        )}

        {!isLoading && !isError && polls && polls.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-border/60 rounded-xl bg-card/20">
            <div className="bg-muted/50 p-4 rounded-full mb-5 shadow-sm">
              <SearchX className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">まだイベントがありません</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-7 leading-relaxed">
              新しいイベントを作成して、日程調整を始めましょう。作成したイベントの共有リンクを参加者に送るだけで回答を集められます。
            </p>
            <Button asChild size="lg" className="font-bold shadow-sm">
              <Link href="/manage">
                <Plus className="w-4 h-4 mr-2" />
                最初のイベントを作成する
              </Link>
            </Button>
          </div>
        )}

        {!isLoading && !isError && polls && polls.length > 0 && (
          <div className="space-y-4">
            {polls.map((poll) => (
              <div 
                key={poll.shareId}
                className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 p-5 sm:p-6 bg-card/40 border border-border/60 rounded-xl hover:bg-card/60 hover:border-border/80 transition-all shadow-sm"
              >
                <div className="space-y-3 flex-1 min-w-0">
                  <div>
                    <div className="flex items-center gap-2 mb-2.5">
                      {poll.isClosed ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/20 bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          <CalendarClock className="h-3 w-3" /> 締切済み
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          <Calendar className="h-3 w-3" /> 募集中
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-xs text-foreground font-medium bg-background border border-border/50 px-2.5 py-0.5 rounded-full shadow-sm">
                        回答 {poll.responseCount} 件
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-foreground leading-snug truncate">
                      {poll.title}
                    </h3>
                    {poll.note && (
                      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                        {poll.note}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <span>作成: {formatDateTime(poll.createdAt)}</span>
                    <span className={poll.isClosed ? "text-destructive/80 font-medium" : ""}>
                      {poll.isClosed ? "回答締切済み" : `締切: ${formatDateTime(poll.deadline)}`}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-row sm:flex-col items-center sm:items-stretch gap-2 shrink-0 pt-2 sm:pt-0 sm:w-40 border-t sm:border-t-0 border-border/40 sm:border-l sm:pl-5">
                  {!poll.isClosed && (
                    <Button asChild size="sm" variant="outline" className="w-full h-9 font-bold">
                      <Link href={`/p/${poll.shareId}/edit`} data-testid={`link-edit-poll-${poll.shareId}`}>
                        編集する <Pencil className="ml-1.5 w-3.5 h-3.5" />
                      </Link>
                    </Button>
                  )}
                  <Button asChild size="sm" className="w-full h-9 font-bold shadow-sm">
                    <Link href={`/p/${poll.shareId}`}>
                      詳細を見る <ExternalLink className="ml-1.5 w-3.5 h-3.5" />
                    </Link>
                  </Button>
                  <div className="flex-1 sm:flex-none">
                    <CopyLinkButton shareId={poll.shareId} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
