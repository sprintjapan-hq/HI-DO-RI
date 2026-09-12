import { useEffect } from "react";

import { Layout } from "@/components/layout";

const externalLinkClass =
  "text-primary underline underline-offset-4 hover:text-primary/80";

export default function Privacy() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "プライバシーポリシー | HI-DO-RI";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <Layout>
      <article className="mx-auto w-full max-w-[760px] space-y-10 text-sm leading-7 text-foreground/90 sm:text-base sm:leading-8">
        <header>
          <h1 className="font-serif text-3xl font-bold text-foreground sm:text-4xl">
            HI-DO-RI プライバシーポリシー
          </h1>
        </header>

        <p>
          スプリントジャパン株式会社（以下「当社」）は、無料日程調整アプリ「HI-DO-RI」（
          <a
            href="https://hi-do-ri.replit.app/"
            target="_blank"
            rel="noreferrer"
            className={externalLinkClass}
          >
            https://hi-do-ri.replit.app/
          </a>
          {" "}、以下「本サービス」）における利用者の情報の取扱いについて、以下のとおり定めます。
        </p>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">1. 取得する情報</h2>
          <p>当社は、本サービスの提供にあたり、次の情報を取得します。</p>
          <div className="space-y-3">
            <p>(1) 主催者（Google アカウントでサインインする方）の情報：Google から提供される氏名、メールアドレス、プロフィール画像、アカウントの識別子。</p>
            <p>(2) 出欠表の内容：イベント名、メモ、候補日時、締切、確定した日時。</p>
            <p>(3) 回答者の情報（サインインは不要です）：回答時に入力されたお名前（ニックネームでも構いません）、候補日ごとの出欠（○・△・×）、コメント。</p>
            <p>(4) Google カレンダー連携の情報（主催者が任意で連携した場合のみ）：連携した Google アカウントの識別子とメールアドレス、候補日時における空き状況（予定の有無のみで、予定の件名や内容は取得しません）、本サービスが作成したカレンダー予定の識別子とリンク。</p>
            <p>(5) 機能リクエストフォームの情報：お名前、連絡先（任意）、ご要望および利用場面の内容。</p>
            <p>(6) 技術的な情報：サービスの運営に必要な範囲で、アクセス日時、IP アドレス、ブラウザの種類等のアクセスログが、ホスティング事業者の仕組みにより記録される場合があります。</p>
            <p>(7) ブラウザ内に保存する情報：表示設定（テーマ）、作成した出欠表の一覧、サインイン処理中の状態を、利用者のブラウザ（localStorage・sessionStorage）に保存します。これらは当社のサーバーには送信されません。また、認証サービス（Clerk）がログイン状態を維持するために Cookie を使用します。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">2. 利用目的</h2>
          <p>取得した情報は、次の目的に限って利用します。</p>
          <div className="space-y-1">
            <p>・出欠表の作成、共有、回答の受付と集計</p>
            <p>・主催者の本人確認とログイン状態の維持</p>
            <p>・Google カレンダー連携機能の提供（候補日時の空き状況の表示、候補日の仮予定と確定した予定の作成・更新・削除）</p>
            <p>・お問い合わせおよび機能リクエストへの対応、本サービスの改善</p>
            <p>・不正利用の防止、障害への対応</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">3. Google ユーザーデータの取扱い</h2>
          <p>
            本サービスが Google API から受け取った情報の使用および他のアプリへの転送は、限定使用の要件を含む Google API サービスのユーザーデータに関するポリシー（
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer"
              className={externalLinkClass}
            >
              https://developers.google.com/terms/api-services-user-data-policy
            </a>
            {" "}）に準拠します。
          </p>
          <div className="space-y-1">
            <p>・Google カレンダーへの操作は、主催者自身の操作（カレンダーの連携、候補日の登録、日程の確定）に基づくものに限ります。予定の作成時に、参加者へ招待通知は送信しません。</p>
            <p>・Google ユーザーデータを広告の目的で利用することはなく、販売することもありません。</p>
            <p>・Google ユーザーデータを、汎用的な人工知能・機械学習モデルの開発・改善・学習に利用することはありません。</p>
            <p>・当社の従業員が Google ユーザーデータを閲覧するのは、利用者の同意がある場合、セキュリティ上の目的（不正利用の調査等）、または法令に基づく場合に限ります。</p>
            <p>
              ・カレンダー連携は、本サービス内でいつでも解除できます。Google アカウントの設定（
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noreferrer"
                className={externalLinkClass}
              >
                https://myaccount.google.com/permissions
              </a>
              {" "}）からも、本サービスへのアクセス権を取り消すことができます。
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">4. 出欠表の公開範囲と第三者提供</h2>
          <p>出欠表の内容と回答（お名前・出欠・コメント）は、その出欠表の URL を知っている人が閲覧できます。URL を共有する範囲にご注意ください。</p>
          <p>当社は、法令に基づく場合を除き、本人の同意なく個人情報を第三者に提供しません。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">5. 外部サービスの利用（外国にある事業者を含む）</h2>
          <p>当社は、本サービスの運営のため、次の外部サービスを利用し、その範囲で情報の取扱いを委託しています。これらの事業者は米国に所在します。</p>
          <div className="space-y-1">
            <p>・Replit, Inc.（ホスティング、データベース）</p>
            <p>・Clerk, Inc.（認証・ログイン）</p>
            <p>・Google LLC（Google アカウントによるログイン、Google カレンダー連携）</p>
            <p>・Slack Technologies, LLC（機能リクエストの当社内への通知）</p>
          </div>
          <p>
            外国における個人情報の保護に関する制度については、個人情報保護委員会のウェブサイト（
            <a
              href="https://www.ppc.go.jp/"
              target="_blank"
              rel="noreferrer"
              className={externalLinkClass}
            >
              https://www.ppc.go.jp/
            </a>
            {" "}）をご参照ください。
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">6. 保存期間と削除</h2>
          <p>出欠表と回答は、本サービスの提供に必要な期間保存します。出欠表・回答・機能リクエストの削除をご希望の場合は、下記の窓口までご連絡ください。ご本人であることを確認のうえ、遅滞なく対応します。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">7. 安全管理</h2>
          <p>当社は、通信の暗号化（HTTPS）、データへのアクセス権限の制限その他の措置により、取得した情報の漏えい、滅失または毀損の防止に努めます。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">8. 開示等のご請求・お問い合わせ</h2>
          <p>保有する個人情報の開示、訂正、利用停止、削除等のご請求、および本ポリシーに関するお問い合わせは、次の窓口で受け付けます。</p>
          <div>
            <p>
              窓口：お問い合わせフォーム（
              <a
                href="https://sprintjapan.net/contact"
                target="_blank"
                rel="noreferrer"
                className={externalLinkClass}
              >
                https://sprintjapan.net/contact
              </a>
              {" "}）
            </p>
            <p>事業者：スプリントジャパン株式会社</p>
            <p>代表者：代表取締役 夏本健司</p>
            <p>所在地：ご請求に応じて遅滞なく回答します。</p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">9. アクセス解析について</h2>
          <p>本サービスでは、アクセス解析ツールは使用していません。</p>
        </section>

        <section className="space-y-4">
          <h2 className="font-serif text-2xl font-bold text-foreground">10. 改定</h2>
          <p>当社は、必要に応じて本ポリシーを改定します。改定した場合は、本ページに掲載した時点から効力を生じます。</p>
        </section>

        <footer className="space-y-1 border-t border-border/60 pt-8">
          <p>制定日：2026年9月10日</p>
          <p>スプリントジャパン株式会社</p>
        </footer>
      </article>
    </Layout>
  );
}