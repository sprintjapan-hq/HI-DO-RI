import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Loader2, MessageSquarePlus, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateFeatureRequest } from "@workspace/api-client-react";

export default function FeatureRequest() {
  const [sent, setSent] = useState(false);
  const mutation = useCreateFeatureRequest();

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "追加機能リクエスト・ご相談 | HI-DO-RI";
    return () => { document.title = previousTitle; };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await mutation.mutateAsync({
        data: {
          name: String(form.get("name") ?? "").trim(),
          contact: String(form.get("contact") ?? "").trim() || undefined,
          request: String(form.get("request") ?? "").trim(),
          useCase: String(form.get("useCase") ?? "").trim() || undefined,
        },
      });
      setSent(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      toast.error("送信できませんでした。入力内容を確認して、もう一度お試しください。");
    }
  }

  return (
    <Layout>
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" />トップへ戻る
        </Link>

        {sent ? (
          <div className="rounded-xl border border-primary/30 bg-card p-8 text-center shadow-xl shadow-black/5">
            <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
            <h1 className="mt-5 font-serif text-2xl font-bold">リクエストを送信しました</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              ご意見ありがとうございます。HI-DO-RIの今後の改善に役立てます。
            </p>
            <Button asChild className="mt-7"><Link href="/">HI-DO-RIへ戻る</Link></Button>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />HI-DO-RIをもっと便利に
              </div>
              <h1 className="font-serif text-3xl font-bold sm:text-4xl">追加機能リクエスト・ご相談</h1>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
                欲しい機能や困っていることをお聞かせください。内容はHI-DO-RI運営チームへ直接届きます。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-border/80 bg-card p-6 shadow-xl shadow-black/5 sm:p-8">
              <MessageSquarePlus className="h-6 w-6 text-primary" />
              <div className="space-y-2">
                <Label htmlFor="name">お名前 <span className="text-primary">*</span></Label>
                <Input id="name" name="name" required maxLength={80} placeholder="例：山田 太郎" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact">連絡先（任意）</Label>
                <Input id="contact" name="contact" maxLength={160} placeholder="メールアドレスなど" />
                <p className="text-xs text-muted-foreground">回答が必要な場合にご入力ください。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="request">欲しい機能・相談内容 <span className="text-primary">*</span></Label>
                <Textarea id="request" name="request" required minLength={10} maxLength={2000} rows={7} placeholder="追加してほしい機能や、ご相談内容をご記入ください。" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="useCase">利用場面・困っていること（任意）</Label>
                <Textarea id="useCase" name="useCase" maxLength={1000} rows={4} placeholder="どのような場面で必要かを教えてください。" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                送信いただいた内容は、サービス改善の検討にのみ利用します。機密情報やパスワードは入力しないでください。
              </p>
              <Button type="submit" className="w-full font-bold" disabled={mutation.isPending}>
                {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />送信中...</> : "リクエストを送信する"}
              </Button>
            </form>
          </>
        )}
      </div>
    </Layout>
  );
}