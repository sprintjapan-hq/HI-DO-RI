import { useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useUser } from "@clerk/react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetPoll, 
  useUpdatePoll,
  getGetPollQueryKey,
  getListOrganizerPollsQueryKey
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, Calendar, AlertCircle, Plus, Trash2, ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

const baseSchema = z.object({
  title: z.string().trim().min(1, "イベント名を入力してください").max(100, "100文字以内で入力してください"),
  note: z.string().max(500, "500文字以内で入力してください").optional(),
  newCandidates: z.array(
    z.object({
      label: z.string().trim().min(1, "候補日を入力してください").max(100, "100文字以内で入力してください"),
    })
  ),
});

type FormValues = z.infer<typeof baseSchema>;

export default function EditPoll() {
  const [, setLocation] = useLocation();
  const params = useParams<{ shareId: string }>();
  const { user } = useUser();
  const queryClient = useQueryClient();
  
  const shareId = params.shareId || "";
  const { data: poll, isLoading, isError } = useGetPoll(shareId, {
    query: {
      enabled: !!user && !!shareId,
      queryKey: [...getGetPollQueryKey(shareId), user?.id],
    },
  });
  const updatePoll = useUpdatePoll();

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(
      baseSchema.refine((data) => {
        const existingCount = poll?.candidates.length || 0;
        return existingCount + data.newCandidates.length <= 20;
      }, {
        message: "候補日は合計20件までです",
        path: ["newCandidates"]
      })
    ),
    defaultValues: { title: "", note: "", newCandidates: [] },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "newCandidates"
  });

  useEffect(() => {
    if (poll) {
      reset({
        title: poll.title,
        note: poll.note,
        newCandidates: []
      });
    }
  }, [poll, reset]);

  const onSubmit = (data: FormValues) => {
    if (!poll) return;

    updatePoll.mutate({
      shareId: poll.shareId,
      data: {
        title: data.title,
        note: data.note || "",
        newCandidates: data.newCandidates.map((c) => c.label),
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPollQueryKey(poll.shareId) });
        queryClient.invalidateQueries({ queryKey: getListOrganizerPollsQueryKey() });
        toast.success("イベント内容を保存しました");
        setLocation(`/p/${poll.shareId}`);
      },
      onError: (error) => {
        const apiMessage = (error as { data?: { error?: string } }).data?.error;
        toast.error(apiMessage ?? "保存に失敗しました。もう一度お試しください。");
      }
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" data-testid="status-loading">
          <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary/50" />
          <p className="animate-pulse">読み込み中...</p>
        </div>
      </Layout>
    );
  }

  if (isError || !poll) {
    return (
      <Layout>
        <div className="text-center py-20" data-testid="status-error">
          <div className="bg-destructive/10 text-destructive inline-flex h-16 w-16 items-center justify-center rounded-full mb-4">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold mb-2">出欠表が見つかりません</h1>
          <p className="text-muted-foreground">読み込みに失敗したか、削除された可能性があります。</p>
          <Button variant="outline" className="mt-8" onClick={() => setLocation("/")} data-testid="link-back-to-home">
            トップページへ
          </Button>
        </div>
      </Layout>
    );
  }

  if (!poll.canManage) {
    return (
      <Layout>
        <div className="text-center py-20" data-testid="status-unauthorized">
          <div className="bg-destructive/10 text-destructive inline-flex h-16 w-16 items-center justify-center rounded-full mb-4">
            <AlertCircle className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold mb-2">編集権限がありません</h1>
          <p className="text-muted-foreground">この出欠表を編集する権限がありません。</p>
          <Button variant="outline" className="mt-8" onClick={() => setLocation(`/p/${poll.shareId}`)} data-testid="link-back-to-poll">
            <ArrowLeft className="mr-2 h-4 w-4" /> 出欠表へ戻る
          </Button>
        </div>
      </Layout>
    );
  }

  if (poll.isClosed) {
    return (
      <Layout>
        <div className="text-center py-20" data-testid="status-closed">
          <div className="bg-primary/10 text-primary inline-flex h-16 w-16 items-center justify-center rounded-full mb-4">
            <Calendar className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold mb-2">確定・締切済みの出欠表です</h1>
          <p className="text-muted-foreground">すでに開催日が確定しているか、締め切られているため編集できません。</p>
          <Button variant="outline" className="mt-8" onClick={() => setLocation(`/p/${poll.shareId}`)} data-testid="link-back-to-poll">
            <ArrowLeft className="mr-2 h-4 w-4" /> 出欠表へ戻る
          </Button>
        </div>
      </Layout>
    );
  }

  const isMaxCandidates = poll.candidates.length + fields.length >= 20;
  
  return (
    <Layout>
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 space-y-2">
          <h1 className="font-serif text-2xl font-bold text-foreground sm:text-3xl" data-testid="text-edit-title">
            イベントの編集
          </h1>
          <p className="text-sm text-muted-foreground">
            イベントの内容を変更したり、新しい候補日を追加できます。既存の候補日は変更できません。
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 p-6 sm:p-8" data-testid="form-edit-poll">
            <div className="space-y-2">
              <Label htmlFor="title">イベント名</Label>
              <Input 
                id="title" 
                placeholder="例: 経営者向けAI勉強会 B-5" 
                className="bg-background/60 text-base" 
                {...register("title")} 
                data-testid="input-title"
              />
              {errors.title && <p className="text-sm text-destructive" data-testid="error-title">{errors.title.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="note" className="flex items-center gap-2">
                詳細文 <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">任意</span>
              </Label>
              <Textarea 
                id="note" 
                placeholder="例: 会場は新宿。19:00開始・2時間ほど" 
                className="min-h-[92px] resize-y bg-background/60" 
                {...register("note")} 
                data-testid="textarea-note"
              />
              {errors.note && <p className="text-sm text-destructive" data-testid="error-note">{errors.note.message}</p>}
            </div>

            <div className="space-y-3">
              <Label>既存の候補日</Label>
              <div className="rounded-md border border-border/60 bg-muted/20 p-4 space-y-3" data-testid="list-existing-candidates">
                {poll.candidates.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-sm text-muted-foreground font-medium" data-testid={`item-existing-candidate-${c.id}`}>
                    <Calendar className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                    <span>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>新しい候補日の追加</Label>
                <span className="text-xs text-muted-foreground">
                  合計 {poll.candidates.length + fields.length} / 20 件
                </span>
              </div>
              
              {fields.length > 0 && (
                <div className="space-y-2" data-testid="list-new-candidates">
                  {fields.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <Input
                          placeholder="例: 9/24(水) 19:00"
                          className="bg-background/60"
                          {...register(`newCandidates.${index}.label`)}
                          data-testid={`input-new-candidate-${index}`}
                        />
                        {errors.newCandidates?.[index]?.label && (
                          <p className="text-xs text-destructive" data-testid={`error-new-candidate-${index}`}>
                            {errors.newCandidates[index]?.label?.message}
                          </p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(index)}
                        data-testid={`button-remove-candidate-${index}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {(errors.newCandidates?.root?.message || errors.newCandidates?.message) && (
                <p className="text-sm text-destructive" data-testid="error-new-candidates-root">
                  {errors.newCandidates.root?.message || errors.newCandidates.message}
                </p>
              )}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full border border-dashed border-border/80 bg-background/50 hover:bg-muted/50"
                onClick={() => append({ label: "" })}
                disabled={isMaxCandidates}
                data-testid="button-add-candidate"
              >
                <Plus className="mr-2 h-4 w-4" />
                候補日を追加
              </Button>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-border/70 pt-6 sm:flex-row sm:justify-end">
              <Button 
                type="button" 
                variant="ghost" 
                onClick={() => setLocation(`/p/${poll.shareId}`)}
                data-testid="link-cancel-edit"
              >
                キャンセル
              </Button>
              <Button 
                type="submit" 
                className="font-bold" 
                disabled={updatePoll.isPending}
                data-testid="button-submit-edit"
              >
                {updatePoll.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 保存中...</>
                ) : (
                  <><Save className="mr-2 h-4 w-4" /> 変更を保存する</>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}
