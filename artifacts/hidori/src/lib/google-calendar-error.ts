export const GOOGLE_CALENDAR_RECONNECT_ERROR_CODE =
  "google_calendar_reconnect_required";

export function needsGoogleCalendarReconnect(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  return (
    !!data &&
    typeof data === "object" &&
    "code" in data &&
    data.code === GOOGLE_CALENDAR_RECONNECT_ERROR_CODE
  );
}