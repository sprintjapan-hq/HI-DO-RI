import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import {
  getListOrganizerPollsQueryKey,
  useClaimLegacyPoll,
} from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";

const TARGET_SHARE_ID = "ml73WmEq";

export default function ClaimLegacyPoll() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const claim = useClaimLegacyPoll();
  const token = new URLSearchParams(search).get("token") ?? "";
  const isValidLink = token.length >= 20;

  const handleClaim = () => {
    setError("");
    claim.mutate(
      {
        shareId: TARGET_SHARE_ID,
        data: { claimToken: token },
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListOrganizerPollsQueryKey() });
        },
        onError: (claimError) => {
          const message = (claimError as { data?: { error?: string } }).data?.error;
          setError(message ?? "イベントを引き継げませんでした。");
        },
      },
    );
  };

  return (
    <Layout>
      <div className="mx-auto w-full max-w-lg py-8">
        <div className="rounded-xl border border-border/60 bg-card/50 p-6 sm:p-8">
          <h1 className="font-serif text-2xl font-bold">以前のイベントを引き継ぐ</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            「経営者向けAI勉強会Bグループ 第5回目」を、現在ログイン中のアカウントのマイページへ追加します。
          </p>

          {!isValidLink && (
            <div className="mt-6 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              引き継ぎリンクが正しくありません。
            </div>
          )}

          {error && (
            <div className="mt-6 flex gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {claim.isSuccess ? (
            <div className="mt-6 space-y-4">
              <div className="flex gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-500">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                マイページへの追加が完了しました。
              </div>
              <Button className="w-full font-bold" onClick={() => setLocation("/mypage")}>
                マイページを確認する
              </Button>
            </div>
          ) : (
            <Button
              className="mt-6 w-full font-bold"
              disabled={!isValidLink || claim.isPending}
              onClick={handleClaim}
            >
              {claim.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              このアカウントへ追加する
            </Button>
          )}
        </div>
      </div>
    </Layout>
  );
}