import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCalendarConnectionQueryKey,
  useDisableCalendarConnection,
  useEnableCalendarConnection,
  useGetCalendarConnection,
} from "@workspace/api-client-react";
import { Calendar, Loader2, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
];
const OAUTH_INTENT_KEY = "hidori_google_calendar_oauth_intent";

export function CalendarConnection() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetCalendarConnection({
    query: {
      enabled: !!user,
      queryKey: getGetCalendarConnectionQueryKey(),
    },
  });
  const enable = useEnableCalendarConnection();
  const disable = useDisableCalendarConnection();
  const [isAuthorizing, setIsAuthorizing] = useState(false);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetCalendarConnectionQueryKey() });

  useEffect(() => {
    if (
      !user ||
      data?.connected ||
      enable.isPending ||
      sessionStorage.getItem(OAUTH_INTENT_KEY) !== "pending"
    ) return;
    const account = user.externalAccounts.find((item) => item.provider === "google");
    const approvedScopes = new Set(account?.approvedScopes.split(" ") ?? []);
    if (!CALENDAR_SCOPES.every((scope) => approvedScopes.has(scope))) return;
    enable.mutate(undefined, {
      onSuccess: () => {
        sessionStorage.removeItem(OAUTH_INTENT_KEY);
        refresh();
        toast.success("Googleカレンダーを接続しました");
      },
    });
  }, [data?.connected, enable, user]);

  const connect = async () => {
    if (!user) return;
    setIsAuthorizing(true);
    try {
      const account = user.externalAccounts.find((item) => item.provider === "google");
      const authorized = account
        ? await account.reauthorize({
            additionalScopes: CALENDAR_SCOPES,
            redirectUrl: window.location.href,
          })
        : await user.createExternalAccount({
            strategy: "oauth_google",
            additionalScopes: CALENDAR_SCOPES,
            redirectUrl: window.location.href,
          });
      const oauthUrl = authorized.verification?.externalVerificationRedirectURL;
      if (oauthUrl) {
        sessionStorage.setItem(OAUTH_INTENT_KEY, "pending");
        window.location.assign(oauthUrl.toString());
        return;
      }
      enable.mutate(undefined, {
        onSuccess: () => {
          sessionStorage.removeItem(OAUTH_INTENT_KEY);
          refresh();
          toast.success("Googleカレンダーを接続しました");
        },
        onError: () => toast.error("Googleカレンダーの接続を完了できませんでした"),
      });
    } catch {
      toast.error("Googleカレンダーの接続を開始できませんでした");
    } finally {
      setIsAuthorizing(false);
    }
  };

  if (!user || isLoading) return null;

  if (data?.connected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-primary" />
          <span>
            Googleカレンダー接続済み
            {data.email ? <span className="ml-2 text-muted-foreground">{data.email}</span> : null}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disable.isPending}
          onClick={() => disable.mutate(undefined, {
            onSuccess: () => {
              sessionStorage.removeItem(OAUTH_INTENT_KEY);
              refresh();
              toast.success("HI-DO-RIとGoogleカレンダーの連携を解除しました");
            },
          })}
        >
          <Unplug className="mr-2 h-4 w-4" />アプリ連携を解除
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-4">
      <p className="text-sm text-muted-foreground">
        自分のGoogleカレンダーを接続すると、空き時間の抽出と予定登録ができます。
      </p>
      <Button type="button" variant="outline" size="sm" disabled={isAuthorizing} onClick={connect}>
        {isAuthorizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
        Googleカレンダーを接続
      </Button>
    </div>
  );
}