import { Link } from "wouter";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { Layout } from "@/components/layout";
import { HomeScreenshots } from "@/components/home-screenshots";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <Layout>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center">
          <div className="mb-10 space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              主催者ログイン制
            </div>
            <h1 className="font-serif text-3xl font-bold leading-tight text-foreground sm:text-5xl">
              集まる日を「なるはや」で<br />決めたい。
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              HI-DO-RI は、主催者が開催候補を決めて、リンクを配るだけ。参加者はログインせず、○△×で都合を伝えられます。
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border/80 bg-card p-6 shadow-xl shadow-black/10">
              <LockKeyhole className="mb-5 h-5 w-5 text-primary" />
              <h2 className="font-serif text-lg font-bold">主催者として始める</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                イベント作成と管理には、主催者アカウントでのログインが必要です。
              </p>
              <Button asChild className="mt-6 w-full font-bold">
                <Link href="/sign-in">ログインして作成する <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
              <p className="mt-4 text-center text-xs text-muted-foreground">
                初めての方は <Link href="/sign-up" className="font-medium text-primary hover:underline">アカウントを作成</Link>
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-6">
              <h2 className="font-serif text-lg font-bold">参加者の方へ</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                主催者から届いたイベントURLを開いてください。回答にログインは必要ありません。
              </p>
              <p className="mt-6 text-xs leading-relaxed text-muted-foreground/80">
                HI-DO-RI は、共有URLを知っている人だけが回答できるシンプルな日程調整サービスです。
              </p>
            </div>
          </div>
        </div>

        <HomeScreenshots />
      </div>
    </Layout>
  );
}