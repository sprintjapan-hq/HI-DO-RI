import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export type AvailabilityAnswer = "yes" | "maybe" | "no";
export type OrganizerAvailabilityDraft = {
  enabled: boolean;
  name: string;
  answers: Record<string, AvailabilityAnswer>;
  comment: string;
};

type Props = {
  candidates: Array<{ key: string; label: string }>;
  existingCandidates: Array<{ id: number }>;
  responses: Array<{ name: string; answers: AvailabilityAnswer[]; comment?: string | null }>;
  value: OrganizerAvailabilityDraft;
  onChange: (value: OrganizerAvailabilityDraft) => void;
};

export function OrganizerAvailability({ candidates, existingCandidates, responses, value, onChange }: Props) {
  const changeName = (name: string) => {
    const existing = responses.find((response) => response.name === name.trim());
    onChange({
      ...value,
      name,
      comment: existing?.comment ?? "",
      answers: existing ? Object.fromEntries(existingCandidates.flatMap((candidate, index) =>
        existing.answers[index] ? [[String(candidate.id), existing.answers[index]]] : [],
      )) : {},
    });
  };

  return (
    <section className="space-y-4 border-t border-border/70 pt-6" aria-label="主催者の出欠">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={value.enabled}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          data-testid="checkbox-edit-own-availability" />
        自分の出欠（○・△・×）も保存する
      </label>
      {value.enabled && <>
        <p className="text-xs leading-relaxed text-muted-foreground">
          以前の回答を変更する場合は、同じ名前を入力してください。その名前の回答を読み込み、保存時に更新します。他の参加者の名前は選ばないでください。
        </p>
        <div className="space-y-2">
          <Label htmlFor="organizer-name">回答に使う自分の名前</Label>
          <Input id="organizer-name" value={value.name} maxLength={80} list="existing-response-names"
            onChange={(event) => changeName(event.target.value)} data-testid="input-organizer-name" />
          <datalist id="existing-response-names">
            {responses.map((response) => <option key={response.name} value={response.name} />)}
          </datalist>
        </div>
        <div className="divide-y divide-border/60 rounded-md border border-border/60">
          {candidates.map((candidate) => (
            <div key={candidate.key} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words text-sm">{candidate.label || "新しい候補日"}</span>
              <div className="flex shrink-0 gap-1" role="group" aria-label={`${candidate.label || "新しい候補日"}の出欠`}>
                {([["yes", "○"], ["maybe", "△"], ["no", "×"]] as const).map(([answer, symbol]) => (
                  <Button key={answer} type="button" size="sm"
                    variant={value.answers[candidate.key] === answer ? "default" : "outline"}
                    aria-pressed={value.answers[candidate.key] === answer}
                    aria-label={`${candidate.label || "新しい候補日"}：${symbol}`}
                    onClick={() => onChange({ ...value, answers: { ...value.answers, [candidate.key]: answer } })}
                    data-testid={`organizer-answer-${candidate.key}-${answer}`}>
                    {symbol}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">すべての候補日に○・△・×のいずれかを選んでください。</p>
      </>}
    </section>
  );
}
