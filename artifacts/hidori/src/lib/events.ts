export type SavedEvent = {
  shareId: string;
  title: string;
  createdAt: string;
  deadline: string | null;
};

const STORAGE_KEY_PREFIX = "hidori.saved-events";

function storageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}.${userId}`;
}

export function readSavedEvents(userId: string): SavedEvent[] {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (event): event is SavedEvent =>
        typeof event === "object" &&
        event !== null &&
        typeof (event as SavedEvent).shareId === "string" &&
        typeof (event as SavedEvent).title === "string" &&
        typeof (event as SavedEvent).createdAt === "string",
    );
  } catch {
    return [];
  }
}

export function saveEvent(event: SavedEvent, userId: string): SavedEvent[] {
  const next = [
    event,
    ...readSavedEvents(userId).filter((saved) => saved.shareId !== event.shareId),
  ].slice(0, 30);
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  return next;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "締切なし";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "日時未設定";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}