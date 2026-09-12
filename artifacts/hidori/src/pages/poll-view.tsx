import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useUser } from "@clerk/react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetPoll, 
  useCreatePollResponse, 
  useConfirmPoll,
  getGetPollQueryKey,
  getListOrganizerPollsQueryKey,
  PollResponseAnswersItem,
  PollResponseInputAnswersItem,
  useCreateCalendarEvent,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, Check, Users, Calendar, ArrowRight, LockKeyhole, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/events";
import { needsGoogleCalendarReconnect } from "@/lib/google-calendar-error";
import { CalendarConnection } from "@/components/calendar-connection";

const responseSchema = z.object({
  name: z.string().min(1, "お名前を入力してください").max(80, "80文字以内で入力してください"),
  answers: z.array(z.enum(["yes", "maybe", "no"])),
  comment: z.string().max(500, "500文字以内で入力してください").optional().nullable(),
});

type ResponseFormValues = z.infer<typeof responseSchema>;

const AnswerSymbol = ({ answer }: { answer: string }) => {
  if (answer === "yes") return <span className="text-primary font-bold text-lg leading-none">○</span>;
  if (answer === "maybe") return <span className="text-primary/70 text-lg leading-none">△</span>;
  if (answer === "no") return <span className="text-muted-foreground/30 text-lg leading-none">×</span>;
  return <span className="text-muted-foreground/60 text-sm leading-none" title="未回答">―</span>;
};

export default function PollView() {
  const [location, setLocation] = useLocation();
  const params = useParams<{ shareId: string }>();
  const { user, isLoaded: isUserLoaded } = useUser();
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams(location.split("?")[1] ?? "");
  const isNewlyCreated = searchParams.get("created") === "true";
  const adminKey = searchParams.get("admin") ?? "";
  
  const shareId = params.shareId || "";
  const { data: poll, isLoading, error } = useGetPoll(shareId, {
    query: {
      enabled: isUserLoaded && !!shareId,
      queryKey: [...getGetPollQueryKey(shareId), user?.id ?? "anonymous"],
    },
  });
  const isAdmin = adminKey.length > 0 || poll?.canManage === true;
  const deadlinePassed = !!poll?.deadline && new Date(poll.deadline).getTime() <= Date.now();
  const createResponse = useCreatePollResponse();
  const confirmPoll = useConfirmPoll({
    request: {
      headers: {
        "X-Admin-Key": adminKey,
      },
    },
  });
  const createCalendarEvent = useCreateCalendarEvent();
  const [calendarEventLink, setCalendarEventLink] = useState<string | null>(null);

  const { register, handleSubmit, control, formState, reset } = useForm<ResponseFormValues>({
    resolver: zodResolver(responseSchema),
    defaultValues: {
      name: "",
      answers: [],
      comment: ""
    }
  });

  // Initialize form when poll data loads
  useEffect(() => {
    if (poll && !formState.isDirty && formState.submitCount === 0) {
      reset({
        name: "",
        answers: poll.candidates.map(() => "yes"),
        comment: ""
      });
    }
  }, [poll, reset, formState.isDirty, formState.submitCount]);

  const [copiedUrl, setCopiedUrl] = useState<"share" | "admin" | null>(null);
  const shareUrl = window.location.origin + window.location.pathname; // remove query string
  const adminUrl = `${shareUrl}?admin=${encodeURIComponent(adminKey)}`;

  const copyToClipboard = async (url: string, kind: "share" | "admin") => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(kind);
      toast.success("URLをコピーしました");
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  const confirmCandidate = (candidateId: number, label: string) => {
    if (!poll || !isAdmin) return;
    const confirmed = window.confirm(
      `「${label}」を開催日に確定しますか？\n確定すると回答受付は締め切られ、元に戻せません。`,
    );
    if (!confirmed) return;

    confirmPoll.mutate(
      {
        shareId: poll.shareId,
        data: { candidateId },
      },
      {
        onSuccess: (confirmedPoll) => {
          queryClient.setQueryData(getGetPollQueryKey(poll.shareId), confirmedPoll);
          queryClient.invalidateQueries({ queryKey: getListOrganizerPollsQueryKey() });
          toast.success("開催日を確定し、回答受付を締め切りました");
          window.scrollTo({ top: 0, behavior: "smooth" });
        },
        onError: (error) => {
          queryClient.invalidateQueries({ queryKey: getGetPollQueryKey(poll.shareId) });
          if (needsGoogleCalendarReconnect(error)) {
            toast.error(
              "開催日は確定しました。Googleカレンダーを再接続してから「確認・再同期」を押してください。",
            );
            return;
          }
          toast.error(
            "開催日の確定状態を再確認してください。Googleカレンダー同期に失敗した場合は、確定後の「確認・再同期」から再試行できます。",
          );
        },
      },
    );
  };

  const onSubmit = (data: ResponseFormValues) => {
    if (!poll) return;
    if (deadlinePassed) {
      toast.error("このイベントの回答受付は終了しています。");
      return;
    }
    
    createResponse.mutate({
      shareId: poll.shareId,
      data: {
        name: data.name,
        answers: data.answers as PollResponseInputAnswersItem[],
        comment: data.comment || undefined,
      }
    }, {
      onSuccess: () => {
        toast.success("回答を送信しました");
        queryClient.invalidateQueries({ queryKey: getGetPollQueryKey(poll.shareId) });
        queryClient.invalidateQueries({ queryKey: getListOrganizerPollsQueryKey() });
        // Scroll to top of table
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Reset form for potential next entry but keep dirty state tracked
        reset({
          name: "",
          answers: poll.candidates.map(() => "yes"),
          comment: ""
        });
      },
      onError: () => {
        toast.error("送信に失敗しました。もう一度お試しください。");
      }
    });
  };

  if (!isUserLoaded || isLoading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary/50" />
          <p className="animate-pulse">読み込み中...</p>
        </div>
      </Layout>
    );
  }

  if (error || !poll) {
    return (
      <Layout>
        <div className="text-center py-20">
          <div className="bg-destructive/10 text-destructive inline-flex h-16 w-16 items-center justify-center rounded-full mb-4">
            <span className="text-2xl font-bold">!</span>
          </div>
          <h1 className="text-xl font-bold mb-2">出欠表が見つかりません</h1>
          <p className="text-muted-foreground">URLが間違っているか、削除された可能性があります。</p>
          <Button variant="outline" className="mt-8" onClick={() => window.location.href = '/'}>
            トップページへ
          </Button>
        </div>
      </Layout>
    );
  }

  const confirmedCandidate = poll.candidates.find(
    (candidate) => candidate.id === poll.confirmedCandidateId,
  );

  return (
    <Layout>
      {isAdmin && (
        <div className="mb-10 p-6 bg-primary/5 border border-primary/20 rounded-lg animate-in fade-in slide-in-from-top-4">
          <h2 className="text-primary font-bold mb-2 flex items-center gap-2">
            {isNewlyCreated && (
              <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">完了</span>
            )}
            {isNewlyCreated ? "出欠表を作成しました！" : "参加者向け共有リンク"}
          </h2>
          <p className="text-sm text-foreground/80 mb-4">
            このURLをコピーして、参加者に共有してください。
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input 
              readOnly 
              value={shareUrl} 
              className="bg-background/50 font-mono text-xs sm:text-sm"
              onClick={(e) => e.currentTarget.select()}
            />
            <Button onClick={() => copyToClipboard(shareUrl, "share")} variant="default" className="shrink-0 group">
              {copiedUrl === "share" ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2 group-hover:scale-110 transition-transform" />}
              {copiedUrl === "share" ? "コピーしました" : "共有URLをコピー"}
            </Button>
          </div>
          {adminKey && (
          <div className="mt-5 pt-5 border-t border-primary/15">
            <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <LockKeyhole className="h-4 w-4 text-primary" />
              主催者専用の管理URL
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              開催日の確定に必要です。参加者には共有せず、大切に保存してください。
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                readOnly
                value={adminUrl}
                className="bg-background/50 font-mono text-xs sm:text-sm"
                onClick={(event) => event.currentTarget.select()}
              />
              <Button onClick={() => copyToClipboard(adminUrl, "admin")} variant="outline" className="shrink-0">
                {copiedUrl === "admin" ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copiedUrl === "admin" ? "コピーしました" : "管理URLをコピー"}
              </Button>
            </div>
          </div>
          )}
        </div>
      )}

      <div className="space-y-8 animate-in fade-in duration-700">
        {/* Header Section */}
        <div className="space-y-4">
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-foreground leading-tight">
            {poll.title}
          </h1>
          {poll.note && (
            <div className="p-4 bg-muted/30 rounded-md border border-border/40 text-sm whitespace-pre-wrap leading-relaxed text-foreground/80">
              {poll.note}
            </div>
          )}
          {poll.deadline && !poll.isClosed && (
            <div className="inline-flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm text-primary">
              <Calendar className="h-4 w-4" />
              回答締切: {formatDateTime(poll.deadline)}
            </div>
          )}
        </div>

        {poll.isClosed && confirmedCandidate && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary text-primary-foreground p-2.5 shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-primary mb-1">開催日が確定しました</p>
                <h2 className="text-xl sm:text-2xl font-serif font-bold text-foreground">
                  {confirmedCandidate.label}
                </h2>
                <p className="text-sm text-muted-foreground mt-2">回答受付は終了しています。</p>
                {isAdmin && confirmedCandidate.start && confirmedCandidate.end && (
                  <div className="mt-4 border-t border-primary/20 pt-4">
                    <CalendarConnection />
                    {calendarEventLink ? (
                      <Button type="button" variant="outline" size="sm" onClick={() => window.open(calendarEventLink, "_blank")}>
                        <Check className="mr-2 h-4 w-4" /> Googleカレンダーに登録済み
                      </Button>
                    ) : <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="font-bold"
                      disabled={createCalendarEvent.isPending}
                      onClick={() => {
                        createCalendarEvent.mutate({
                          data: {
                            shareId: poll.shareId,
                          }
                        }, {
                          onSuccess: (res) => {
                            toast.success("Googleカレンダーの予定を確認しました");
                            setCalendarEventLink(res.htmlLink);
                            if (res.htmlLink) {
                              window.open(res.htmlLink, "_blank");
                            }
                          },
                          onError: (error) => {
                            if (needsGoogleCalendarReconnect(error)) {
                              toast.error(
                                "Googleカレンダーの権限が切れています。再接続してからもう一度お試しください。",
                              );
                              return;
                            }
                            toast.error("Googleカレンダーへの追加に失敗しました");
                          }
                        });
                      }}
                    >
                      {createCalendarEvent.isPending ? (
                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 登録中...</>
                      ) : (
                        <><Calendar className="mr-2 h-4 w-4" /> Googleカレンダーを確認・再同期</>
                      )}
                    </Button>}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Matrix Section */}
        {!poll.isClosed && (
        <>
        <div className="bg-card rounded-lg border border-border/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="p-4 font-medium text-muted-foreground sticky left-0 bg-card z-10 shadow-[1px_0_0_0_var(--color-border)] min-w-[120px]">
                    <div className="flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      参加者
                    </div>
                  </th>
                  {poll.candidates.map(c => (
                    <th key={c.id} className="p-4 font-medium text-center min-w-[100px] border-l border-border/40">
                      <div className="flex flex-col items-center justify-center text-foreground">
                        {c.label.split(' ').map((part, i) => (
                          <span key={i}>{part}</span>
                        ))}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Summary Row */}
                <tr className="border-b border-border bg-muted/10">
                  <td className="p-4 text-xs font-medium sticky left-0 bg-card z-10 shadow-[1px_0_0_0_var(--color-border)]">
                    <span className="bg-background px-2 py-1 rounded-md border border-border/50 text-foreground/80">
                      {poll.responses.length}人 回答済
                    </span>
                  </td>
                  {poll.candidates.map(c => (
                    <td key={c.id} className="p-4 text-center border-l border-border/40">
                      <div className="flex flex-col items-center gap-1">
                        <span className={cn(
                          "font-bold text-lg",
                          c.yesCount > 0 ? "text-primary" : "text-muted-foreground/30"
                        )}>
                          {c.yesCount > 0 ? c.yesCount : '-'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">○の数</span>
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Responses */}
                {poll.responses.map(r => (
                  <tr key={r.id} className="border-b border-border/30 last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="p-4 sticky left-0 bg-card z-10 shadow-[1px_0_0_0_var(--color-border)] align-top">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-foreground">{r.name}</span>
                        {r.comment && (
                          <span 
                            className="text-xs text-muted-foreground/80 whitespace-normal break-words max-w-[140px] leading-relaxed" 
                            title={r.comment}
                          >
                            {r.comment}
                          </span>
                        )}
                      </div>
                    </td>
                    {poll.candidates.map((c, i) => {
                      const ans = r.answers[i];
                      return (
                        <td key={c.id} className="p-4 text-center border-l border-border/40 align-middle">
                          <AnswerSymbol answer={ans} />
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {poll.responses.length === 0 && (
                  <tr>
                    <td colSpan={poll.candidates.length + 1} className="p-12 text-center text-muted-foreground/60 font-medium">
                      まだ回答がありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Input Form Section */}
        <div className="bg-card rounded-lg border border-border/80 shadow-sm overflow-hidden mt-8">
          <div className="p-6 border-b border-border/40 bg-muted/10">
            <h2 className="text-lg font-serif font-bold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              出欠を入力する
            </h2>
          </div>
          <form onSubmit={handleSubmit(onSubmit)} className="p-6 sm:p-8 space-y-8">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-base">お名前</Label>
              <Input 
                id="name" 
                placeholder="例: 山田 太郎" 
                className="text-base py-5 max-w-sm bg-background/50 focus:bg-background"
                {...register("name")} 
              />
              {formState.errors.name && <p className="text-sm text-destructive mt-1">{formState.errors.name.message}</p>}
            </div>

            <div className="space-y-0 rounded-md border border-border/50 overflow-hidden divide-y divide-border/50">
              {poll.candidates.map((c, i) => (
                <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-background/30 hover:bg-muted/20 transition-colors gap-4">
                  <div className="font-medium text-foreground">{c.label}</div>
                  <Controller
                    control={control}
                    name={`answers.${i}`}
                    render={({ field }) => (
                      <div className="flex bg-muted/40 p-1 rounded-md border border-border/60 shrink-0">
                        <label className="flex-1 sm:flex-none cursor-pointer relative group">
                          <input disabled={deadlinePassed} type="radio" className="sr-only" value="yes" checked={field.value === "yes"} onChange={() => field.onChange("yes")} />
                          <div className={cn(
                            "px-5 py-2 rounded text-center text-sm font-bold transition-all",
                            field.value === "yes" 
                              ? "bg-background shadow-sm text-primary ring-1 ring-border" 
                              : "text-muted-foreground group-hover:text-foreground group-hover:bg-background/50"
                          )}>○</div>
                        </label>
                        <label className="flex-1 sm:flex-none cursor-pointer relative group">
                          <input disabled={deadlinePassed} type="radio" className="sr-only" value="maybe" checked={field.value === "maybe"} onChange={() => field.onChange("maybe")} />
                          <div className={cn(
                            "px-5 py-2 rounded text-center text-sm font-bold transition-all",
                            field.value === "maybe" 
                              ? "bg-background shadow-sm text-primary/70 ring-1 ring-border" 
                              : "text-muted-foreground group-hover:text-foreground group-hover:bg-background/50"
                          )}>△</div>
                        </label>
                        <label className="flex-1 sm:flex-none cursor-pointer relative group">
                          <input disabled={deadlinePassed} type="radio" className="sr-only" value="no" checked={field.value === "no"} onChange={() => field.onChange("no")} />
                          <div className={cn(
                            "px-5 py-2 rounded text-center text-sm font-bold transition-all",
                            field.value === "no" 
                              ? "bg-background shadow-sm text-muted-foreground ring-1 ring-border" 
                              : "text-muted-foreground group-hover:text-foreground group-hover:bg-background/50"
                          )}>×</div>
                        </label>
                      </div>
                    )}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="comment" className="text-base flex items-center gap-2">
                コメント <span className="text-xs text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full">任意</span>
              </Label>
              <Textarea 
                id="comment" 
                placeholder="例: 24日なら少し遅れて参加になります。" 
                className="resize-y min-h-[80px] text-base bg-background/50 focus:bg-background"
                {...register("comment")} 
              />
              {formState.errors.comment && <p className="text-sm text-destructive mt-1">{formState.errors.comment.message}</p>}
            </div>

            <div className="pt-2">
              <Button 
                type="submit" 
                size="lg" 
                className="w-full sm:w-auto font-bold text-base px-10 py-6 h-auto transition-transform active:scale-95"
                disabled={createResponse.isPending || deadlinePassed}
              >
                {createResponse.isPending ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> 送信中...</>
                ) : (
                  <>入力する <ArrowRight className="ml-2 h-5 w-5 opacity-70" /></>
                )}
              </Button>
            </div>
          </form>
        </div>

        {isAdmin && !poll.isClosed && (
          <section className="mt-8 overflow-hidden rounded-lg border border-primary/25 bg-card shadow-sm">
            <div className="flex flex-col gap-4 border-b border-border/60 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div>
                <h2 className="font-serif text-lg font-bold flex items-center gap-2">
                  <LockKeyhole className="h-4 w-4 text-primary" />
                  主催者メニュー
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  内容を編集するか、開催日を選んで回答受付を締め切れます。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => setLocation(`/p/${poll.shareId}/edit`)}
                data-testid="button-edit-poll"
              >
                <Pencil className="mr-2 h-4 w-4" />
                日程を編集
              </Button>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
              {poll.candidates.map((candidate) => (
                <Button
                  key={candidate.id}
                  type="button"
                  variant="outline"
                  className="h-auto min-h-12 justify-between gap-4 whitespace-normal text-left"
                  disabled={confirmPoll.isPending}
                  onClick={() => confirmCandidate(candidate.id, candidate.label)}
                >
                  <span>{candidate.label}</span>
                  {confirmPoll.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <span className="text-xs text-primary shrink-0">確定する</span>
                  )}
                </Button>
              ))}
            </div>
          </section>
        )}
        </>
        )}
      </div>
    </Layout>
  );
}
