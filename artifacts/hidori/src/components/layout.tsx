import { ReactNode } from "react";
import { Link } from "wouter";
import { useAuth, useClerk } from "@clerk/react";
import { LogOut, Moon, Plus, Sun, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { DragonMark } from "@/components/dragon-mark";

export function Layout({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const { isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();
  return (
    <div className="min-h-[100dvh] flex flex-col font-sans text-foreground bg-background selection:bg-primary/20">
      <header className="w-full border-b border-border/60 bg-background/80 backdrop-blur-md sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-baseline gap-2 group outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            <DragonMark className="h-11 w-11 text-[#f97316] drop-shadow-[0_0_7px_rgba(249,115,22,0.4)]" />
            <span className="font-sans text-xl font-bold tracking-[0.08em] text-primary transition-colors group-hover:text-primary/80 sm:text-2xl">
              HI-DO-RI
            </span>
            <span className="text-[0.55rem] font-semibold tracking-[0.08em] text-white sm:text-[0.6rem]">
              イベント日程調整アプリ
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {isSignedIn ? (
              <>
                <Link
                  href="/mypage"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/80 bg-card/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <UserRound className="h-4 w-4" />
                  <span className="hidden sm:inline">マイページ</span>
                </Link>
                <Link
                  href="/manage"
                  className="hidden h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
                >
                  <Plus className="h-4 w-4" />
                  新規作成
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    queryClient.clear();
                    await signOut({ redirectUrl: "/" });
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border/80 bg-card/60 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="ログアウト"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden lg:inline">ログアウト</span>
                </button>
              </>
            ) : (
              <Link href="/sign-in" className="hidden text-xs font-medium text-muted-foreground hover:text-primary sm:inline">
                主催者ログイン
              </Link>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border/80 bg-card/60 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={theme === "dark" ? "ライトモードに切り替える" : "ダークモードに切り替える"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline">{theme === "dark" ? "ライト" : "ダーク"}</span>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col">
        {children}
      </main>
      <footer className="w-full py-10 mt-auto border-t border-border/40 text-center">
        <div className="flex flex-col items-center gap-3">
          <nav aria-label="サービス情報" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <Link
              href="/feature-request"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              追加機能リクエスト
            </Link>
            <span aria-hidden="true" className="text-border">|</span>
            <Link
              href="/feature-history"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              機能追加履歴
            </Link>
            <span aria-hidden="true" className="text-border">|</span>
            <Link
              href="/privacy"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              プライバシーポリシー
            </Link>
            <span aria-hidden="true" className="text-border">|</span>
            <Link
              href="/terms"
              className="text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ご利用規約
            </Link>
          </nav>
          <p className="text-sm font-semibold tracking-[0.08em] text-foreground/90">
            Produce by SPRINT Japan
          </p>
        </div>
      </footer>
    </div>
  );
}
