import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, AlertCircle, ArrowRight, CheckCircle2, SearchX, Clock, MessageSquare, ShieldAlert } from "lucide-react";
import { formatDateTime } from "@/lib/events";
import {
  useListFeatureRequestDevelopment,
  useUpdateFeatureRequestDevelopmentStatus,
  getListFeatureRequestDevelopmentQueryKey,
  FeatureRequestDevelopmentStatus,
  type FeatureRequestDevelopmentItem,
} from "@workspace/api-client-react";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  received: { label: '受付済', color: 'bg-muted text-muted-foreground border-muted-foreground/20' },
  approved: { label: '承認済', color: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400' },
  in_progress: { label: '開発中', color: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400' },
  validating: { label: '検証中', color: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400' },
  preview_ready: { label: 'プレビュー準備完了', color: 'bg-pink-500/10 text-pink-600 border-pink-500/20 dark:text-pink-400' },
  completed: { label: '完了', color: 'bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400' },
};

const getNextActionConfig = (currentStatus: string) => {
  switch (currentStatus) {
    case 'received':
      return { next: 'approved' as const, buttonLabel: '承認して着手待ちへ', requiresConfirm: false };
    case 'approved':
      return { next: 'in_progress' as const, buttonLabel: '開発を開始する', requiresConfirm: false };
    case 'in_progress':
      return { next: 'validating' as const, buttonLabel: '検証へ進める', requiresConfirm: false };
    case 'validating':
      return { next: 'preview_ready' as const, buttonLabel: 'プレビュー準備完了とする', requiresConfirm: false };
    case 'preview_ready':
      return { next: 'completed' as const, buttonLabel: '完了通知を送る', requiresConfirm: true };
    default:
      return null;
  }
};

function RequestCard({
  item,
  onUpdateStatus,
}: {
  item: FeatureRequestDevelopmentItem;
  onUpdateStatus: (id: number, nextStatus: FeatureRequestDevelopmentStatus, note?: string) => void;
}) {
  const [note, setNote] = useState(item.developmentNote || "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const actionConfig = getNextActionConfig(item.developmentStatus);
  const statusConfig = STATUS_CONFIG[item.developmentStatus] || STATUS_CONFIG.received;
  
  const handleActionClick = () => {
    if (!actionConfig) return;
    if (actionConfig.requiresConfirm) {
      if (!note.trim()) {
        toast.error("機能履歴に公開するリリース情報を入力してください");
        return;
      }
      setConfirmOpen(true);
    } else {
      onUpdateStatus(item.id, actionConfig.next, note);
    }
  };

  const handleConfirmAction = () => {
    if (!actionConfig) return;
    onUpdateStatus(item.id, actionConfig.next, note);
    setConfirmOpen(false);
  };

  return (
    <div className="bg-card/40 border border-border/60 rounded-xl p-5 sm:p-6 shadow-sm hover:bg-card/60 transition-colors flex flex-col gap-5">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-3 flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full border border-border/40">
              #{item.id}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusConfig.color}`}>
              {statusConfig.label}
            </span>
            {item.notificationStatus === 'sent' && (
              <span className="inline-flex items-center text-xs font-medium text-green-600 dark:text-green-400 gap-1 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
                <CheckCircle2 className="w-3 h-3" /> 通知済
              </span>
            )}
            {item.notificationStatus === 'failed' && (
              <span className="inline-flex items-center text-xs font-medium text-destructive gap-1 bg-destructive/10 px-2 py-0.5 rounded-full border border-destructive/20">
                <AlertCircle className="w-3 h-3" /> 通知失敗
              </span>
            )}
          </div>
          
          <div>
            <h3 className="text-lg font-bold text-foreground leading-snug break-words">
              {item.name}
            </h3>
            <div className="mt-3 bg-muted/30 border border-border/40 rounded-lg p-3.5 space-y-3">
              <div>
                <p className="text-xs font-semibold text-primary/70 mb-1 flex items-center gap-1.5 uppercase tracking-wider">
                  <MessageSquare className="w-3.5 h-3.5" /> リクエスト内容
                </p>
                <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed break-words">{item.request}</p>
              </div>
              {item.useCase && (
                <div className="pt-3 border-t border-border/40">
                  <p className="text-xs font-semibold text-primary/70 mb-1 uppercase tracking-wider">ユースケース</p>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed break-words">{item.useCase}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1 whitespace-nowrap">
              <Clock className="w-3.5 h-3.5" />
              起票: {formatDateTime(item.createdAt)}
            </span>
            <span className="whitespace-nowrap">更新: {formatDateTime(item.developmentStatusUpdatedAt)}</span>
            {item.completedAt && (
              <span className="text-green-600 dark:text-green-400 font-medium whitespace-nowrap">完了: {formatDateTime(item.completedAt)}</span>
            )}
          </div>
        </div>

        {actionConfig && (
          <div className="w-full sm:w-64 flex-shrink-0 flex flex-col gap-3 bg-background/50 border border-border/50 p-4 rounded-xl shadow-sm">
            <div>
              <label htmlFor={`note-${item.id}`} className="text-xs font-semibold text-foreground block mb-1.5">
                {actionConfig.requiresConfirm ? "公開するリリース情報（必須）" : "開発メモ（任意）"}
              </label>
              <Textarea
                id={`note-${item.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={actionConfig.requiresConfirm ? "例: Googleカレンダーから空き時間に合う候補日を自動生成" : "進捗やSlackへ通知したい内容を記入..."}
                className="text-sm min-h-[80px] resize-none bg-card focus-visible:ring-primary/50"
              />
            </div>
            <Button
              onClick={handleActionClick}
              className={`w-full font-bold shadow-sm transition-all ${actionConfig.requiresConfirm ? 'bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-500 dark:hover:bg-indigo-600' : ''}`}
            >
              {actionConfig.buttonLabel}
              {!actionConfig.requiresConfirm && <ArrowRight className="w-4 h-4 ml-1.5" />}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">完了通知を送信しますか？</AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed pt-2">
              開発ステータスを「完了」にし、Slackへ通知します。入力したリリース情報は機能追加履歴へ自動掲載されます。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6">
            <AlertDialogCancel className="font-semibold">キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmAction} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold dark:bg-indigo-500 dark:hover:bg-indigo-600">
              完了通知を送信
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function AdminDevelopment() {
  const queryClient = useQueryClient();
  const { data: items, isLoading, isError, error, refetch } = useListFeatureRequestDevelopment({
    query: {
      queryKey: getListFeatureRequestDevelopmentQueryKey(),
      refetchInterval: 30000,
    }
  });

  const updateStatus = useUpdateFeatureRequestDevelopmentStatus();
  
  const mutateFnRef = useRef(updateStatus.mutate);
  mutateFnRef.current = updateStatus.mutate;

  const handleUpdateStatus = (id: number, nextStatus: FeatureRequestDevelopmentStatus, note?: string) => {
    mutateFnRef.current({
      id,
      data: { status: nextStatus, note: note || undefined }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFeatureRequestDevelopmentQueryKey() });
        toast.success("ステータスを更新しました");
      },
      onError: (err: any) => {
        const errorMessage = err?.response?.data?.error || "更新に失敗しました";
        if (errorMessage.toLowerCase().includes("slack")) {
          toast.error(`Slack連携エラー: ${errorMessage}`);
        } else {
          toast.error(errorMessage);
        }
      }
    });
  };

  // Check for unauthorized access
  if (isError) {
    const apiError = error as any;
    if (apiError?.response?.status === 401 || apiError?.response?.status === 403) {
      return (
        <Layout>
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-destructive/20 rounded-xl bg-destructive/5 max-w-2xl mx-auto mt-8">
            <ShieldAlert className="w-12 h-12 text-destructive/80 mb-4" />
            <h2 className="text-xl font-bold text-destructive mb-3">アクセス権限がありません</h2>
            <p className="text-sm text-destructive/80 max-w-sm">
              このページは運営チーム専用の管理画面です。適切な権限を持つアカウントでログインしてください。
            </p>
          </div>
        </Layout>
      );
    }
  }

  return (
    <Layout>
      <div className="w-full max-w-4xl mx-auto">
        <header className="mb-8 pb-6 border-b border-border/40">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Operator Control Room</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-foreground">開発ステータス管理</h1>
          <p className="text-sm text-muted-foreground mt-2">機能リクエストの進捗管理とSlack通知</p>
        </header>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-primary/40 mb-4" />
            <p className="text-sm text-muted-foreground font-medium animate-pulse">データを読み込み中...</p>
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-destructive/20 rounded-xl bg-destructive/5">
            <AlertCircle className="w-10 h-10 text-destructive/80 mb-4" />
            <h2 className="text-lg font-bold text-destructive mb-2">データの取得に失敗しました</h2>
            <p className="text-sm text-destructive/80 mb-6 max-w-sm">
              通信環境を確認して、再度お試しください。
            </p>
            <Button onClick={() => refetch()} variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10 font-bold">
              再読み込み
            </Button>
          </div>
        )}

        {!isLoading && !isError && items && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-dashed border-border/60 rounded-xl bg-card/20">
            <div className="bg-muted/50 p-4 rounded-full mb-5 shadow-sm">
              <SearchX className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-lg font-bold text-foreground mb-2">リクエストはありません</h2>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
              現在、管理対象の機能リクエストはありません。
            </p>
          </div>
        )}

        {!isLoading && !isError && items && items.length > 0 && (
          <div className="space-y-4">
            {items.map((item) => (
              <RequestCard 
                key={item.id} 
                item={item} 
                onUpdateStatus={handleUpdateStatus} 
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
