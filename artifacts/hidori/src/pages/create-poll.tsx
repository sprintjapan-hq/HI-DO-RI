import { useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Clock3, Loader2, Plus, Sparkles } from "lucide-react";
import { getListOrganizerPollsQueryKey, useCreatePoll, useGenerateCalendarCandidates, CalendarCandidateSlot } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveEvent } from "@/lib/events";
import { needsGoogleCalendarReconnect } from "@/lib/google-calendar-error";
import { toast } from "sonner";
import { CalendarConnection } from "@/components/calendar-connection";

const formSchema = z.object({
  title: z.string().trim().min(1, "イベント名を入力してください").max(120, "120文字以内で入力してください"),
  note: z.string().max(500, "500文字以内で入力してください").optional(),
  candidatesText: z.string().min(1, "候補日を入力してください")
    .refine((value) => value.split("\n").map((line) => line.trim()).filter(Boolean).length >= 2, "候補日は2つ以上入力してください")
    .refine((value) => value.split("\n").map((line) => line.trim()).filter(Boolean).length <= 20, "候補日は20個までです"),
  deadline: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export default function CreatePoll() {
  const [, setLocation] = useLocation();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const createPoll = useCreatePoll();
  const generateCandidates = useGenerateCalendarCandidates();
  
  const [generatorCondition, setGeneratorCondition] = useState("");
  const [generatedSlots, setGeneratedSlots] = useState<CalendarCandidateSlot[]>([]);

  const { register, handleSubmit, formState: { errors }, getValues, setValue } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { title: "", note: "", candidatesText: "", deadline: "" },
  });

  const onSubmit = (data: FormValues) => {
    if (!user) {
      toast.error("イベント作成にはログインが必要です。");
      setLocation("/sign-in");
      return;
    }
    const candidates = data.candidatesText.split("\n").map((line) => line.trim()).filter(Boolean);
    createPoll.mutate(
      {
        data: {
          title: data.title,
          note: data.note || undefined,
          candidates,
          candidateSlots: generatedSlots.filter((slot) => candidates.includes(slot.label)),
          deadline: data.deadline ? new Date(data.deadline).toISOString() : null,
        },
      },
      {
        onSuccess: (poll) => {
          saveEvent({
            shareId: poll.shareId,
            title: poll.title,
            createdAt: poll.createdAt,
            deadline: poll.deadline,
          }, user.id);
          queryClient.invalidateQueries({ queryKey: getListOrganizerPollsQueryKey() });
          toast.success("出欠表を作成しました");
          setLocation(`/p/${poll.shareId}?created=true&admin=${encodeURIComponent(poll.adminKey)}`);
        },
        onError: (error) => {
          const apiMessage = (error as { data?: { error?: string } }).data?.error;
          toast.error(apiMessage ?? "作成に失敗しました。もう一度お試しください。");
        },
      },
    );
  };

  return (
    <Layout>
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-9 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Clock3 className="h-3.5 w-3.5" />
            複数イベント対応
          </div>
          <h1 className="font-serif text-3xl font-bold leading-tight text-foreground sm:text-4xl">候補日を出して、<br className="sm:hidden" />URLを配る</h1>
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            主催者ログインが必要です。イベントごとに日程を作ってURLを送れば、参加者はログインせずに○△×を入れられます。
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl shadow-black/10">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-7 p-6 sm:p-8">
            <div className="space-y-2">
              <Label htmlFor="title">イベント名</Label>
              <Input id="title" placeholder="例: 経営者向けAI勉強会 B-5" className="bg-background/60 text-base" {...register("title")} />
              {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="note" className="flex items-center gap-2">
                ひとこと <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">任意</span>
              </Label>
              <Textarea id="note" placeholder="例: 会場は新宿。19:00開始・2時間ほど" className="min-h-[92px] resize-y bg-background/60" {...register("note")} />
              {errors.note && <p className="text-sm text-destructive">{errors.note.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="candidatesText">候補日 <span className="font-normal text-muted-foreground">（1行に1つ）</span></Label>
              <CalendarConnection />
              {(
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3 mb-2">
                  <div className="flex items-center gap-2 text-primary font-medium text-sm">
                    <Sparkles className="h-4 w-4" />
                    <span>Googleカレンダーから候補日を生成</span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="例: 来週の平日19時から2時間"
                      value={generatorCondition}
                      onChange={(e) => setGeneratorCondition(e.target.value)}
                      className="bg-background/80"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!generatorCondition || generateCandidates.isPending}
                      onClick={() => {
                        generateCandidates.mutate(
                          { data: { condition: generatorCondition } },
                          {
                            onSuccess: (res) => {
                              if (res.slots.length === 0) {
                                toast.error("条件に合う候補日が見つかりませんでした");
                                return;
                              }
                              const nextSlots = res.slots.slice(0, 20);
                              setGeneratedSlots(nextSlots);
                              const newText = nextSlots.map((slot) => slot.label).join("\n");
                              setValue("candidatesText", newText, { shouldValidate: true });
                              toast.success(`${nextSlots.length}件の候補日に更新しました`);
                              setGeneratorCondition("");
                            },
                            onError: (error) => {
                              if (needsGoogleCalendarReconnect(error)) {
                                toast.error(
                                  "Googleカレンダーの権限が切れています。再接続してからもう一度お試しください。",
                                );
                                return;
                              }
                              toast.error("日程の抽出に失敗しました");
                            }
                          }
                        );
                      }}
                    >
                      {generateCandidates.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "抽出"}
                    </Button>
                  </div>
                  {generateCandidates.isSuccess && generateCandidates.data?.interpretation && (
                    <p className="text-xs text-muted-foreground">
                      解釈: {generateCandidates.data.interpretation}
                    </p>
                  )}
                </div>
              )}
              <Textarea
                id="candidatesText"
                placeholder={"9/24(水) 19:00\n9/27(土) 15:00\n9/30(火) 19:00"}
                className="min-h-[150px] resize-y bg-background/60 leading-relaxed"
                {...register("candidatesText")}
              />
              {errors.candidatesText && <p className="text-sm text-destructive">{errors.candidatesText.message}</p>}
              <p className="text-xs text-muted-foreground">改行で区切って入力してください。候補日は2〜20件まで設定できます。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deadline" className="flex items-center gap-2">
                回答締切 <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">任意</span>
              </Label>
              <Input id="deadline" type="datetime-local" className="bg-background/60 sm:max-w-xs" {...register("deadline")} />
              <p className="text-xs text-muted-foreground">締切を過ぎると参加者は回答できなくなります。</p>
              {errors.deadline && <p className="text-sm text-destructive">{errors.deadline.message}</p>}
            </div>

            <div className="flex flex-col gap-3 border-t border-border/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">1アカウントにつき24時間に10件まで作成できます</span>
              <Button type="submit" size="lg" className="font-bold shadow-lg shadow-primary/20" disabled={createPoll.isPending}>
                {createPoll.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />作成中...</> : <><Plus className="mr-2 h-4 w-4" />出欠表を作る</>}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
}