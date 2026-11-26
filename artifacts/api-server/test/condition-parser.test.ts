import { test } from "node:test";
import assert from "node:assert";
import { parseCondition, generateCandidateSlots } from "../src/routes/condition-parser";

const TIME_ZONE = "Asia/Tokyo";

function tokyoDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function formatDateRange(start: Date | null, end: Date | null) {
  if (!start || !end) return null;
  const startParts = tokyoDateParts(start);
  const endParts = tokyoDateParts(new Date(end.getTime() - 1));
  return `${startParts.year}/${startParts.month}/${startParts.day}-${endParts.year}/${endParts.month}/${endParts.day}`;
}

// ========== 11/25実運用不具合修正テスト ==========

test("parseCondition: 12月1日から4日の間の午後 (日付範囲の最終日を含む)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("12月1日から4日の間の午後", now);
  
  assert.ok(parsed, "parseConditionがnullを返してはいけない");
  assert.ok(parsed.rangeStart, "rangeStartが設定されているべき");
  assert.ok(parsed.rangeEnd, "rangeEndが設定されているべき");
  
  // rangeStartは12月1日0時
  assert.strictEqual(parsed.rangeStart.toISOString(), "2024-11-30T15:00:00.000Z"); // 12/1 0時 JST = 11/30 15時 UTC
  // rangeEndは12月5日0時（12月4日の翌日）
  assert.strictEqual(parsed.rangeEnd.toISOString(), "2024-12-04T15:00:00.000Z"); // 12/5 0時 JST = 12/4 15時 UTC
  
  assert.strictEqual(parsed.startHour, 13, "午後の開始時刻は13時");
  assert.strictEqual(parsed.endTimeMinutes, 18 * 60, "午後の終了時刻は18時");
});

test("generateCandidateSlots: 12月1日から4日の間の午後 (12/1, 12/2, 12/3, 12/4の4日分の候補が生成される)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("12月1日から4日の間の午後", now);
  const slots = generateCandidateSlots(parsed, now);
  
  // 12月1日、2日、3日、4日の4日分、各日13-18時でデフォルト2時間枠なら4枠（13:00, 14:00, 15:00, 16:00）= 16候補
  assert.ok(slots.length >= 16, `12/1-4の4日分の候補が必要（実際: ${slots.length}件）`);
  
  // 各日付が含まれているか確認
  const days = [...new Set(slots.map(slot => slot.day))];
  assert.ok(days.includes(1), "12月1日の候補が含まれているべき");
  assert.ok(days.includes(2), "12月2日の候補が含まれているべき");
  assert.ok(days.includes(3), "12月3日の候補が含まれているべき");
  assert.ok(days.includes(4), "12月4日の候補が含まれているべき");
});

test("generateCandidateSlots: 12月1日〜4日 (スラッシュ表記)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("12月1日〜4日", now);
  const slots = generateCandidateSlots(parsed, now);
  
  const days = [...new Set(slots.map(slot => slot.day))];
  assert.ok(days.includes(1), "12月1日の候補が含まれているべき");
  assert.ok(days.includes(2), "12月2日の候補が含まれているべき");
  assert.ok(days.includes(3), "12月3日の候補が含まれているべき");
  assert.ok(days.includes(4), "12月4日の候補が含まれているべき");
});

test("generateCandidateSlots: 12/1〜12/4 (スラッシュ+数字表記)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("12/1〜12/4", now);
  const slots = generateCandidateSlots(parsed, now);
  
  const days = [...new Set(slots.map(slot => slot.day))];
  assert.ok(days.includes(1), "12月1日の候補が含まれているべき");
  assert.ok(days.includes(2), "12月2日の候補が含まれているべき");
  assert.ok(days.includes(3), "12月3日の候補が含まれているべき");
  assert.ok(days.includes(4), "12月4日の候補が含まれているべき");
});

test("generateCandidateSlots: 12月1日から12月4日 (冗長表記)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("12月1日から12月4日", now);
  const slots = generateCandidateSlots(parsed, now);
  
  const days = [...new Set(slots.map(slot => slot.day))];
  assert.ok(days.includes(1), "12月1日の候補が含まれているべき");
  assert.ok(days.includes(2), "12月2日の候補が含まれているべき");
  assert.ok(days.includes(3), "12月3日の候補が含まれているべき");
  assert.ok(days.includes(4), "12月4日の候補が含まれているべき");
});

test("generateCandidateSlots: 11月28日〜12月2日 (月跨ぎ)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("11月28日〜12月2日", now);
  const slots = generateCandidateSlots(parsed, now);
  
  const daysWithMonths = [...new Set(slots.map(slot => `${slot.month}/${slot.day}`))];
  assert.ok(daysWithMonths.includes("11/28"), "11月28日の候補が含まれているべき");
  assert.ok(daysWithMonths.includes("11/29"), "11月29日の候補が含まれているべき");
  assert.ok(daysWithMonths.includes("11/30"), "11月30日の候補が含まれているべき");
  assert.ok(daysWithMonths.includes("12/1"), "12月1日の候補が含まれているべき");
  assert.ok(daysWithMonths.includes("12/2"), "12月2日の候補が含まれているべき");
});

test("generateCandidateSlots: 明日 (1日だけ)", () => {
  const now = new Date("2024-11-26T10:00:00+09:00");
  const parsed = parseCondition("明日", now);
  const slots = generateCandidateSlots(parsed, now);
  
  const days = [...new Set(slots.map(slot => slot.day))];
  assert.strictEqual(days.length, 1, "明日は1日のみ");
  assert.strictEqual(days[0], 27, "11月27日");
});

// ========== 年推論バグ修正テスト（2026年10月21日基準） ==========

const BASE_NOW = new Date("2026-10-21T10:00:00+09:00");

test("年なし期間: 開始日が昨日、終わりが未来 → 今年として扱う（バグ修正）", () => {
  const result = parseCondition("10/20-10/25の午後3時間枠", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/25", "今年2026年として解釈");
});

test("年なし期間: 開始日が昨日、終わりが未来、スラッシュ形式 → 今年として扱う", () => {
  const result = parseCondition("10/20-10/25の9:00-15:00、1時間枠", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/25", "今年2026年として解釈");
});

test("年なし期間: 開始日が今日 → 今年として扱う", () => {
  const result = parseCondition("10/21-10/25の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/21-2026/10/25", "今年2026年として解釈");
});

test("年なし期間: 終わりの日が昨日 → 翌年として扱う", () => {
  const result = parseCondition("10/10-10/20の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2027/10/10-2027/10/20", "翌年2027年として解釈");
});

test("年なし期間: 終わりの日が今日 → 今年として扱う（境界条件）", () => {
  const result = parseCondition("10/15-10/21の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/15-2026/10/21", "今年2026年として解釈");
});

test("年なし期間: 日本語形式でも同様 - 開始が昨日、終わりが未来", () => {
  const result = parseCondition("10月20日から10月25日の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/25", "今年2026年として解釈");
});

test("年なし単一日付: 過去の日付は翌年（従来の動作を維持）", () => {
  const result = parseCondition("10/20", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2027/10/20-2027/10/20", "翌年2027年として解釈");
});

test("年なし単一日付: 今日は今年（従来の動作を維持）", () => {
  const result = parseCondition("10/21", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/21-2026/10/21", "今年2026年として解釈");
});

test("月単位指定: 11月の平日 → 11月1日〜30日", () => {
  const result = parseCondition("11月の平日", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "weekday", "平日のみ");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/1-2026/11/30", "今年11月として解釈");
});

test("月単位指定: 12月で午後 → 12月1日〜31日", () => {
  const result = parseCondition("12月で午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/12/1-2026/12/31", "今年12月として解釈");
});

test("月単位指定: 10月の平日 → 今月、今日から月末まで", () => {
  const result = parseCondition("10月の平日", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "weekday", "平日のみ");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/21-2026/10/31", "今年10月21日から31日まで");
});

test("月単位指定: 9月の午後 → 過去の月なので来年", () => {
  const result = parseCondition("9月の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2027/9/1-2027/9/30", "来年9月として解釈");
});

test("今月末まで → 今日から今月末", () => {
  const result = parseCondition("今月末まで 午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/21-2026/10/31", "今月末まで");
});

test("来月末まで → 来月1日から来月末", () => {
  const result = parseCondition("来月末まで 午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/1-2026/11/30", "来月末まで");
});

test("年なし単一日付: 未来の日付は今年（従来の動作を維持）", () => {
  const result = parseCondition("10/25", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/25-2026/10/25", "今年2026年として解釈");
});

test("年なし期間: 月をまたぐ場合（開始が昨日、終わりが来月）", () => {
  const result = parseCondition("10/20-11/5の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/11/5", "今年2026年として解釈");
});

test("年またぎ期間: 12/28-1/5を12/30に入力 → 今年12/28〜翌年1/5", () => {
  const now = new Date("2026-12-30T10:00:00+09:00");
  const result = parseCondition("12/28-1/5の午後", now);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/12/28-2027/1/5", "今年12/28から翌年1/5");
});

test("年またぎ期間: 12/28-1/5を1/3に入力 → 前年12/28〜今年1/5", () => {
  const now = new Date("2027-01-03T10:00:00+09:00");
  const result = parseCondition("12/28-1/5の午後", now);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/12/28-2027/1/5", "前年12/28から今年1/5");
});
