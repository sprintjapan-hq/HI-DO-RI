export type ReleaseCard = {
  version: string;
  date: string;
  time: string;
  title: string;
  features: string[];
};

export type PublishedRelease = {
  id: number;
  note: string;
  completedAt: string;
};

export function toReleaseCard(item: PublishedRelease): ReleaseCard {
  const completedAt = new Date(item.completedAt);
  return {
    version: `完了 #${item.id}`,
    date: new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(completedAt),
    time: new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(completedAt),
    title: item.note,
    features: ["運営画面の完了通知と同時に自動掲載"],
  };
}