export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center justify-center bg-background text-foreground font-sans">
      <h1 className="text-4xl font-serif font-bold text-primary mb-4">404</h1>
      <p className="text-muted-foreground mb-8">ページが見つかりません</p>
      <a href="/" className="text-sm font-medium text-primary hover:underline underline-offset-4 transition-colors">
        トップページへ戻る
      </a>
    </div>
  );
}
