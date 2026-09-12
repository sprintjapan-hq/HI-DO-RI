import organizerScreenshot from "@assets/HIDORI-主催者_1788450243356.png";
import participantInputScreenshot from "@assets/HIDORI-参加者_入力_1788450243379.png";
import participantViewScreenshot from "@assets/HIDORI-参加者表示_1788450243379.png";

const screenshots = [
  {
    number: "01",
    title: "主催者入力フォーム",
    description: "イベント名と候補日を入力して、出欠表を作成します。",
    src: organizerScreenshot,
    alt: "HI-DO-RIの主催者入力フォーム画面",
  },
  {
    number: "02",
    title: "参加者入力フォーム",
    description: "ログインなしで、名前と○△×を入力できます。",
    src: participantInputScreenshot,
    alt: "HI-DO-RIの参加者入力フォーム画面",
  },
  {
    number: "03",
    title: "参加者表示例",
    description: "共有されたURLから、みんなの回答状況を確認できます。",
    src: participantViewScreenshot,
    alt: "HI-DO-RIの参加者回答一覧画面",
  },
];

export function HomeScreenshots() {
  return (
    <section
      className="mt-20 border-t border-border/50 pt-14 pb-4 sm:mt-24 sm:pt-16"
      aria-labelledby="screenshots-heading"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-primary">
          How it works
        </p>
        <h2 id="screenshots-heading" className="font-serif text-2xl font-bold sm:text-3xl">
          画面を見ると、使い方がすぐわかる。
        </h2>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          主催者は候補日を作ってURLを共有。参加者は届いた画面から、そのまま回答できます。
        </p>
      </div>

      <div className="mx-auto mt-10 grid w-full max-w-4xl items-start gap-10">
        {screenshots.map((screenshot) => (
          <figure key={screenshot.number} className="group">
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card p-2 shadow-xl shadow-black/10 transition-transform duration-300 group-hover:-translate-y-1">
              <div className="overflow-hidden rounded-lg border border-border/50 bg-background">
                <img
                  src={screenshot.src}
                  alt={screenshot.alt}
                  loading="lazy"
                  className="block h-auto w-full"
                />
              </div>
            </div>
            <figcaption className="px-1 pt-4">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs font-semibold tracking-[0.16em] text-primary">
                  {screenshot.number}
                </span>
                <h3 className="font-serif text-base font-bold">{screenshot.title}</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {screenshot.description}
              </p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}