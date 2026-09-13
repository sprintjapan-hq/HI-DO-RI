import { useEffect } from "react";

import { Layout } from "@/components/layout";

export default function Terms() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "ご利用規約 | HI-DO-RI";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <Layout>
      <article className="mx-auto w-full max-w-[760px] space-y-10 text-sm leading-7 text-foreground/90 sm:text-base sm:leading-8">
        <header className="space-y-4">
          <h1 className="font-serif text-3xl font-bold text-foreground sm:text-4xl">
            HI-DO-RI ご利用規約
          </h1>
          <p>
            この利用規約（以下「本規約」）は、スプリントジャパン株式会社（以下「当社」）が提供する無料日程調整アプリ「HI-DO-RI」（以下「本サービス」）の利用条件を定めるものです。本サービスを利用する方（以下「利用者」）は、本規約に同意したうえで本サービスをご利用ください。
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第1条（本サービス）</h2>
          <p>本サービスは、イベントの主催者が候補日時を提示し、参加者から出欠回答を受け付け、日程を調整するための機能を提供します。</p>
          <p>本サービスには、主催者向けの出欠表の作成・編集・日程確定、参加者向けの「○・△・×」による回答、Google カレンダー連携、機能リクエスト等の機能が含まれます。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第2条（利用資格と同意）</h2>
          <p>利用者は、本規約および当社のプライバシーポリシーに同意したうえで、本サービスを利用するものとします。</p>
          <p>未成年者が本サービスを利用する場合は、法定代理人の同意を得たうえで利用してください。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第3条（主催者アカウント）</h2>
          <div className="space-y-3">
            <p>1. 出欠表の作成・管理には、当社が指定する認証サービスを利用したサインインが必要です。</p>
            <p>2. 主催者は、自らのアカウントおよび認証情報を適切に管理し、第三者に利用させてはなりません。</p>
            <p>3. アカウントを利用して行われた操作は、当該アカウントの主催者による操作として取り扱います。ただし、当社の責めに帰すべき事由がある場合を除きます。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第4条（出欠表と共有URLの管理）</h2>
          <div className="space-y-3">
            <p>1. 出欠表の内容、参加者名、出欠回答およびコメントは、その出欠表の共有URLを知っている方が閲覧できる場合があります。</p>
            <p>2. 主催者は、共有URLをイベントの関係者以外へ公開しないなど、利用目的に応じて適切に管理してください。</p>
            <p>3. 主催者は、イベント名、説明、候補日時その他の掲載内容および共有先について責任を負います。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第5条（参加者による回答）</h2>
          <div className="space-y-3">
            <p>1. 参加者は、サインインせずに、主催者から共有された出欠表へ名前、出欠回答およびコメントを入力できます。</p>
            <p>2. 参加者は、必要に応じてニックネームを使用し、他人になりすますことなく回答してください。</p>
            <p>3. 参加者は、入力内容が共有URLを知る方に閲覧される可能性があることを理解したうえで、公開に適さない情報を入力しないものとします。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第6条（第三者に関する情報）</h2>
          <p>主催者が参加者その他の第三者に関する情報を本サービスへ入力し、または第三者へ本サービスの利用を案内する場合、主催者は必要な説明、同意の取得その他の適法な手続きを自らの責任で行うものとします。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第7条（Google カレンダー連携）</h2>
          <div className="space-y-3">
            <p>1. 主催者は、任意でGoogle カレンダーを本サービスへ連携できます。</p>
            <p>2. 本サービスは、付与された権限の範囲で候補日時の空き状況を確認します。予定の件名や内容を取得することを目的としたものではありません。</p>
            <p>3. カレンダー予定の作成・更新・削除は、主催者が付与済みの権限を有する場合に限り実行されます。権限の状態、Google側の仕様または障害等により、予定が作成・更新・削除されない場合があります。</p>
            <p>4. 主催者は、日程確定後にGoogle カレンダーへの登録結果を自ら確認してください。本サービス上の日程確定のみをもって、外部カレンダーへの登録完了を保証するものではありません。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第8条（外部サービス）</h2>
          <p>本サービスは、Replit、Clerk、Google、Slackその他の外部サービスを利用しています。利用者は、必要に応じて各外部サービスの利用条件にも従うものとします。外部サービスの障害、停止、仕様変更または利用制限により、本サービスの全部または一部を利用できない場合があります。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第9条（禁止事項）</h2>
          <p>利用者は、本サービスの利用にあたり、次の行為をしてはなりません。</p>
          <div className="space-y-1">
            <p>・法令、公序良俗または本規約に違反する行為</p>
            <p>・第三者になりすます行為、または虚偽もしくは誤解を招く情報を入力する行為</p>
            <p>・第三者の権利、利益、名誉またはプライバシーを侵害する行為</p>
            <p>・本人の同意なく、利用目的に必要な範囲を超えて第三者の個人情報を入力または公開する行為</p>
            <p>・共有URL、回答機能または機能リクエストを利用した迷惑行為、宣伝、勧誘または嫌がらせ</p>
            <p>・不正アクセス、脆弱性の探索、リバースエンジニアリングその他本サービスの安全性を損なう行為</p>
            <p>・本サービスまたは関連するシステムへ過度な負荷をかける行為</p>
            <p>・本サービスの運営を妨害し、またはそのおそれがある行為</p>
            <p>・その他、当社が不適切と合理的に判断する行為</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第10条（知的財産権）</h2>
          <p>本サービスを構成するプログラム、デザイン、ロゴ、文章その他のコンテンツに関する知的財産権は、当社または正当な権利者に帰属します。利用者が入力した内容に関する権利は利用者または正当な権利者に留保されます。</p>
          <p>利用者は、当社に対し、本サービスの提供、保守および改善に必要な範囲で、入力内容を取り扱うことを許諾するものとします。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第11条（利用制限とデータの削除）</h2>
          <p>当社は、利用者が本規約に違反した場合、不正利用またはセキュリティ上の危険がある場合その他本サービスの運営上必要な場合、事前の通知なく、当該利用者による利用を制限し、または関連データを削除できるものとします。ただし、当社は状況に応じて合理的な対応に努めます。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第12条（サービスの変更・中断・終了）</h2>
          <p>当社は、保守、障害対応、セキュリティ対応、外部サービスの変更その他の必要な事情がある場合、本サービスの内容を変更し、または提供を中断もしくは終了することがあります。重大な変更または終了については、合理的な方法で事前にお知らせするよう努めます。ただし、緊急の場合はこの限りではありません。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第13条（保証の否認）</h2>
          <p>当社は、本サービスについて、常時利用できること、障害が生じないこと、入力または生成された候補日時が利用者の意図に完全に一致すること、回答内容が正確であること、外部カレンダーへの登録や通知が必ず完了することを保証しません。利用者は、重要な日程および外部サービスへの反映結果を自ら確認してください。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第14条（当社の責任）</h2>
          <p>当社の責めに帰すべき事由により利用者に損害が生じた場合、当社は、現実に発生した通常かつ直接の損害について責任を負うものとします。ただし、当社に故意または重大な過失がある場合、および消費者契約法その他の法令により責任の制限が認められない場合は、この限りではありません。</p>
          <p>無料で提供される本サービスについて当社が責任を負う場合、その範囲は、当該損害の原因となった事由、サービスの性質および利用状況等を考慮した合理的な範囲とします。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第15条（個人情報の取扱い）</h2>
          <p>利用者の情報の取扱いについては、当社の「HI-DO-RI プライバシーポリシー」に定めます。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第16条（本規約の変更）</h2>
          <p>当社は、法令に従い、必要に応じて本規約を変更できます。変更後の規約は本ページに掲載し、重要な変更については本サービス上での表示その他の適切な方法により周知します。変更後に本サービスを利用した場合、利用者は変更後の規約に同意したものとみなされます。ただし、法令上、利用者の個別の同意が必要な変更については、当社所定の方法で同意を取得します。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第17条（準拠法・合意管轄）</h2>
          <p>本規約は日本法に準拠します。本サービスまたは本規約に関して当社と利用者との間に紛争が生じた場合、当社の本店所在地を管轄する地方裁判所を、第一審の専属的合意管轄裁判所とします。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">第18条（お問い合わせ）</h2>
          <p>
            本規約に関するお問い合わせは、
            <a
              href="https://sprintjapan.net/contact"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-4 hover:text-primary/80"
            >
              お問い合わせフォーム
            </a>
            よりご連絡ください。
          </p>
        </section>

        <footer className="space-y-1 border-t border-border/60 pt-8">
          <p>制定日：2026年9月13日</p>
          <p>スプリントジャパン株式会社</p>
        </footer>
      </article>
    </Layout>
  );
}