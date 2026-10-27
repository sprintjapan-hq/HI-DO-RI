import { useState, useEffect } from "react";
import { Layout } from "@/components/layout";
import { Loader2, AlertCircle, BarChart3, TrendingUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface EventCount {
  event: string;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  count: number;
}

interface StatsResponse {
  eventCounts: EventCount[];
  trackingStartedAt: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  page_view: "ページビュー",
  login_start: "ログイン開始",
  form_start: "フォーム入力開始",
  form_submit: "フォーム送信",
};

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [excludeVerify, setExcludeVerify] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true);
        const response = await fetch(`/api/analytics/stats?excludeVerify=${excludeVerify}`);
        
        if (response.status === 401 || response.status === 403) {
          setError("アクセス権限がありません");
          return;
        }
        
        if (!response.ok) {
          setError("データの取得に失敗しました");
          return;
        }
        
        const data = await response.json();
        setStats(data);
        setError(null);
      } catch (err) {
        setError("通信エラーが発生しました");
      } finally {
        setLoading(false);
      }
    }
    
    fetchStats();
  }, [excludeVerify]);

  if (error === "アクセス権限がありません") {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center border border-destructive/20 rounded-xl bg-destructive/5 max-w-2xl mx-auto mt-8">
          <AlertCircle className="w-12 h-12 text-destructive/80 mb-4" />
          <h2 className="text-xl font-bold text-destructive mb-3">アクセス権限がありません</h2>
          <p className="text-sm text-destructive/80 max-w-sm">
            このページは運営チーム専用の管理画面です。
          </p>
        </div>
      </Layout>
    );
  }

  const groupedByUtm: Record<string, EventCount[]> = {};
  
  if (stats) {
    stats.eventCounts.forEach((item) => {
      const key = `${item.utmSource || "(なし)"}|${item.utmCampaign || "(なし)"}|${item.utmContent || "(なし)"}`;
      if (!groupedByUtm[key]) {
        groupedByUtm[key] = [];
      }
      groupedByUtm[key].push(item);
    });
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "測れない";
    try {
      const date = new Date(dateStr);
      return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
    } catch {
      return "不明";
    }
  };

  const hasData = stats && stats.eventCounts.length > 0;

  return (
    <Layout>
      <div className="w-full max-w-6xl mx-auto space-y-8">
        <header className="pb-6 border-b border-border/40">
          <div className="flex items-center gap-3 mb-2">
            <BarChart3 className="w-8 h-8 text-primary" />
            <h1 className="font-serif text-3xl font-bold text-foreground">アクセス解析</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            プライバシー重視の自社計測データ（個人情報なし、12か月保存）
          </p>
          {stats?.trackingStartedAt && (
            <p className="text-xs text-muted-foreground mt-1">
              計測開始: {formatDate(stats.trackingStartedAt)}
            </p>
          )}
        </header>

        <div className="flex items-center space-x-2">
          <Switch
            id="exclude-verify"
            checked={excludeVerify}
            onCheckedChange={setExcludeVerify}
          />
          <Label htmlFor="exclude-verify" className="text-sm cursor-pointer">
            検証用キャンペーン（hd-verify）を除外
          </Label>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-primary/40 mb-4" />
            <p className="text-sm text-muted-foreground">データを読み込み中...</p>
          </div>
        )}

        {error && error !== "アクセス権限がありません" && (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border border-destructive/20 rounded-xl bg-destructive/5">
            <AlertCircle className="w-10 h-10 text-destructive/80 mb-4" />
            <h2 className="text-lg font-bold text-destructive mb-2">{error}</h2>
          </div>
        )}

        {!loading && !error && !hasData && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              データがありません
            </CardContent>
          </Card>
        )}

        {!loading && !error && hasData && (
          <div className="space-y-6">
            {Object.entries(groupedByUtm).map(([key, items]) => {
              const [source, campaign, content] = key.split("|");
              const eventMap = new Map<string, number>();
              items.forEach((item) => {
                eventMap.set(item.event, item.count);
              });

              const pageViews = eventMap.get("page_view") || 0;
              const loginStarts = eventMap.get("login_start") || 0;
              const formStarts = eventMap.get("form_start") || 0;
              const formSubmits = eventMap.get("form_submit") || 0;

              const formStartRate = pageViews > 0 
                ? ((formStarts / pageViews) * 100).toFixed(1) 
                : "測れない";
              
              const loginToFormRate = loginStarts > 0
                ? ((formStarts / loginStarts) * 100).toFixed(1)
                : "測れない";

              return (
                <Card key={key}>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      流入元: {source}
                    </CardTitle>
                    <CardDescription>
                      キャンペーン: {campaign} / コンテンツ: {content}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
                      {["page_view", "login_start", "form_start", "form_submit"].map((eventType) => (
                        <div key={eventType} className="bg-muted/30 rounded-lg p-4">
                          <div className="text-xs text-muted-foreground mb-1">
                            {EVENT_LABELS[eventType]}
                          </div>
                          <div className="text-2xl font-bold">
                            {eventMap.get(eventType) || 0}
                          </div>
                        </div>
                      ))}
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2 border-t border-border/40 pt-4">
                      <div className="bg-primary/5 rounded-lg p-4">
                        <div className="text-xs text-muted-foreground mb-1">
                          フォーム入力率（入力 / ページ）
                        </div>
                        <div className="text-xl font-bold">
                          {formStartRate === "測れない" ? formStartRate : `${formStartRate}%`}
                        </div>
                      </div>
                      <div className="bg-primary/5 rounded-lg p-4">
                        <div className="text-xs text-muted-foreground mb-1">
                          ログイン→入力率（入力 / ログイン）
                        </div>
                        <div className="text-xl font-bold">
                          {loginToFormRate === "測れない" ? loginToFormRate : `${loginToFormRate}%`}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
