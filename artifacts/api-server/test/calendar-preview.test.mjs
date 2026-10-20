import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCondition, generateCandidateSlots } from "../src/routes/condition-parser.ts";

/**
 * parseCondition のテスト
 * 
 * このテストファイルは condition-parser.ts の関数をテストします。
 * 固定された now を使用して、日付解釈が安定していることを確認します。
 */

// テスト用の固定日時: 2026年10月10日 11:05 JST (土曜日)
const FIXED_NOW = new Date("2026-10-10T11:05:00+09:00");

// テスト用のヘルパー関数群を定義
const TIME_ZONE = "Asia/Tokyo";

function tokyoDateParts(date) {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

// テストヘルパー
function formatDateRange(start, end) {
  if (!start || !end) return null;
  const startParts = tokyoDateParts(start);
  const endParts = tokyoDateParts(new Date(end.getTime() - 1));
  return `${startParts.year}/${startParts.month}/${startParts.day}-${endParts.year}/${endParts.month}/${endParts.day}`;
}

// テストケース
test("parseCondition - 完全な年月日形式の日付範囲", () => {
  const result = parseCondition("2026年10月20日から24日の間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なし月日形式の日付範囲（から）", () => {
  const result = parseCondition("10月20日から24日の間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なし月日形式の日付範囲（〜）", () => {
  const result = parseCondition("10月20日〜10月24日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なし月日形式の日付範囲（ハイフン）", () => {
  const result = parseCondition("10月20日-24日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 完全スラッシュ形式の日付範囲", () => {
  const result = parseCondition("2026/10/20-10/24", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 年なしスラッシュ形式の日付範囲", () => {
  const result = parseCondition("10/20-10/24", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/24");
});

test("parseCondition - 単一日付（月日）", () => {
  const result = parseCondition("10月20日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 単一日付（スラッシュ）", () => {
  const result = parseCondition("10/20", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 単一日付（年月日）", () => {
  const result = parseCondition("2026年10月20日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 単一日付（完全スラッシュ）", () => {
  const result = parseCondition("2026/10/20", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/10/20");
});

test("parseCondition - 相対日付: 明日", () => {
  const result = parseCondition("明日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/11-2026/10/11");
});

test("parseCondition - 相対日付: 明後日", () => {
  const result = parseCondition("明後日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/12-2026/10/12");
});

test("parseCondition - 相対日付: 来週", () => {
  const result = parseCondition("来週", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 2026/10/10 は土曜日なので、来週は 10/12 (月) から 10/18 (日)
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/12-2026/10/18");
});

test("parseCondition - 相対日付: 今週", () => {
  const result = parseCondition("今週", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 2026/10/10 は土曜日なので、今週の残りは 10/10 (土) から 10/11 (日)
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/10-2026/10/11");
});

test("parseCondition - 相対日付: 今月", () => {
  const result = parseCondition("今月", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 10/10 から 10/31 まで
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/10-2026/10/31");
});

test("parseCondition - 相対日付: 来月", () => {
  const result = parseCondition("来月", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 11/1 から 11/30 まで
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/1-2026/11/30");
});

test("parseCondition - 時間帯のみ（デフォルト30日）", () => {
  const result = parseCondition("19時から21時", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効");
  assert.strictEqual(result.horizonDays, 30, "デフォルト30日");
  assert.strictEqual(result.startHour, 19);
  assert.strictEqual(result.endTimeMinutes, 21 * 60);
});

test("parseCondition - 複合: 来週の平日19時から2時間", () => {
  const result = parseCondition("来週の平日19時から2時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効");
  assert.strictEqual(result.dayType, "weekday");
  assert.strictEqual(result.startHour, 19);
  assert.strictEqual(result.durationMinutes, 120);
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/12-2026/10/18");
});

test("parseCondition - 既存の機能: 午前", () => {
  const result = parseCondition("午前", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 9);
  assert.strictEqual(result.endTimeMinutes, 12 * 60);
});

test("parseCondition - 既存の機能: 午後", () => {
  const result = parseCondition("午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 13);
  assert.strictEqual(result.endTimeMinutes, 18 * 60);
});

test("parseCondition - 既存の機能: 平日", () => {
  const result = parseCondition("平日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekday");
});

test("parseCondition - 既存の機能: 土日", () => {
  const result = parseCondition("土日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekend");
});

test("parseCondition - 既存の機能: 1時間", () => {
  const result = parseCondition("1時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.durationMinutes, 60);
});

test("parseCondition - 既存の機能: 90分", () => {
  const result = parseCondition("90分", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.durationMinutes, 90);
});

test("parseCondition - 無効な日付はinvalidDateRangeがtrue", () => {
  const result = parseCondition("2026/13/1", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, true, "無効な日付範囲");
});

test("parseCondition - 年なし過去日付は来年として解釈", () => {
  // 10/10の時点で10/5は過去なので、2027/10/5として解釈
  const result = parseCondition("10/5", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2027/10/5-2027/10/5");
});

// v0.6回帰テスト
test("parseCondition - v0.6回帰: 2026/9/18-9/22の午後。1時間枠", () => {
  const result = parseCondition("2026/9/18-9/22の午後。1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/9/18-2026/9/22");
  assert.strictEqual(result.startHour, 13, "午後の開始時刻");
  assert.strictEqual(result.endTimeMinutes, 18 * 60, "午後の終了時刻");
  assert.strictEqual(result.durationMinutes, 60, "1時間枠");
});

test("parseCondition - v0.6回帰: 2026/9/18-9/22の13:00-15:00、1時間枠", () => {
  const result = parseCondition("2026/9/18-9/22の13:00-15:00、1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/9/18-2026/9/22");
  assert.strictEqual(result.startHour, 13, "開始時刻");
  assert.strictEqual(result.startMinute, 0, "開始分");
  assert.strictEqual(result.endTimeMinutes, 15 * 60, "終了時刻");
  assert.strictEqual(result.durationMinutes, 60, "1時間枠");
});

test("parseCondition - v0.6回帰: 平日9:00-12:00", () => {
  const result = parseCondition("平日9:00-12:00", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekday", "平日のみ");
  assert.strictEqual(result.startHour, 9, "開始時刻");
  assert.strictEqual(result.startMinute, 0, "開始分");
  assert.strictEqual(result.endTimeMinutes, 12 * 60, "終了時刻");
  assert.strictEqual(result.horizonDays, 30, "デフォルト30日");
});

// 時間帯表現の改善テスト (ユーザーレポートに基づく)
test("parseCondition - 10/20-10/25までの午後3時間枠", () => {
  const result = parseCondition("10/20-10/25までの午後3時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 13, "午後の開始: 13時");
  assert.strictEqual(result.endTimeMinutes, 18 * 60, "午後の終了: 18:00");
  assert.strictEqual(result.durationMinutes, 180, "3時間枠");
});

test("parseCondition - 11/5-11/10までの午前中3時間枠", () => {
  const result = parseCondition("11/5-11/10までの午前中3時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 9, "午前の開始: 9時");
  assert.strictEqual(result.endTimeMinutes, 12 * 60, "午前の終了: 12:00");
  assert.strictEqual(result.durationMinutes, 180, "3時間枠");
});

test("parseCondition - 午後に2時間", () => {
  const result = parseCondition("午後に2時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 13, "午後の開始: 13時");
  assert.strictEqual(result.endTimeMinutes, 18 * 60, "午後の終了: 18:00");
  assert.strictEqual(result.durationMinutes, 120, "2時間");
});

test("parseCondition - 昼90分", () => {
  const result = parseCondition("昼90分", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 11, "昼の開始: 11時");
  assert.strictEqual(result.endTimeMinutes, 14 * 60, "昼の終了: 14:00");
  assert.strictEqual(result.durationMinutes, 90, "90分");
});

test("parseCondition - 夕方1時間", () => {
  const result = parseCondition("夕方1時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 16, "夕方の開始: 16時");
  assert.strictEqual(result.endTimeMinutes, 19 * 60, "夕方の終了: 19:00");
  assert.strictEqual(result.durationMinutes, 60, "1時間");
});

test("parseCondition - 午後3時から2時間（具体的な時刻、時間帯ではない）", () => {
  const result = parseCondition("午後3時から2時間", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.startHour, 15, "午後3時 = 15時");
  assert.strictEqual(result.endTimeMinutes, 24 * 60, "デフォルト終了: 24:00");
  assert.strictEqual(result.durationMinutes, 120, "2時間");
});

test("parseCondition - 10/20-10/25までの平日（までのが動作）", () => {
  const result = parseCondition("10/20-10/25までの平日", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "weekday", "平日");
  assert.ok(result.rangeStart, "日付範囲が設定されている");
});

// 曜日指定の新しいテストケース
test("parseCondition - 毎週火曜と木曜", () => {
  const result = parseCondition("2026/11/2-11/13の毎週火曜と木曜の午後、1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "specific", "特定の曜日");
  assert.ok(result.allowedWeekdays, "allowedWeekdaysが設定されている");
  assert.ok(result.allowedWeekdays.includes("火"), "火曜が含まれる");
  assert.ok(result.allowedWeekdays.includes("木"), "木曜が含まれる");
  assert.strictEqual(result.allowedWeekdays.length, 2, "2つの曜日のみ");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/2-2026/11/13");
  assert.strictEqual(result.startHour, 13, "午後の開始時刻");
  assert.strictEqual(result.durationMinutes, 60, "1時間枠");
});

test("parseCondition - 月水金", () => {
  const result = parseCondition("2026/11/2-11/13の月水金の10:00-12:00、1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "specific", "特定の曜日");
  assert.ok(result.allowedWeekdays, "allowedWeekdaysが設定されている");
  assert.ok(result.allowedWeekdays.includes("月"), "月曜が含まれる");
  assert.ok(result.allowedWeekdays.includes("水"), "水曜が含まれる");
  assert.ok(result.allowedWeekdays.includes("金"), "金曜が含まれる");
  assert.strictEqual(result.allowedWeekdays.length, 3, "3つの曜日のみ");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/2-2026/11/13");
  assert.strictEqual(result.startHour, 10, "開始時刻");
  assert.strictEqual(result.endTimeMinutes, 12 * 60, "終了時刻");
});

test("parseCondition - 土日を除く", () => {
  const result = parseCondition("2026/11/2-11/13、土日を除く、13:00-15:00、1時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "weekday", "平日（土日を除く）");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/2-2026/11/13");
  assert.strictEqual(result.startHour, 13, "開始時刻");
  assert.strictEqual(result.endTimeMinutes, 15 * 60, "終了時刻");
});

// 今日開始の範囲テスト（FIXED_NOW は 2026/10/10）
test("parseCondition - 今日開始の範囲は今年として扱う", () => {
  const result = parseCondition("10/10-10/15の午後3時間枠", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 10/10 は FIXED_NOW の日付なので、今年 (2026) として扱う
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/10-2026/10/15");
  assert.strictEqual(result.startHour, 13, "午後の開始");
  assert.strictEqual(result.durationMinutes, 180, "3時間枠");
});

test("parseCondition - 既存の平日・土日・毎日が引き続き動作", () => {
  const weekdayResult = parseCondition("平日", FIXED_NOW);
  assert.strictEqual(weekdayResult?.dayType, "weekday", "平日");
  
  const weekendResult = parseCondition("土日", FIXED_NOW);
  assert.strictEqual(weekendResult?.dayType, "weekend", "土日");
  
  const everydayResult = parseCondition("毎日", FIXED_NOW);
  assert.strictEqual(everydayResult?.dayType, "all", "毎日");
});

// 回帰テスト: 日付内の曜日文字を誤検出しない
test("parseCondition - 2026年11月2日から11月13日の午後（全日として扱う）", () => {
  const result = parseCondition("2026年11月2日から11月13日の午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "all", "全日（曜日指定なし）");
  assert.strictEqual(result.allowedWeekdays, undefined, "allowedWeekdaysは未定義");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/2-2026/11/13");
});

test("parseCondition - 明日の午後（全日として扱う）", () => {
  const result = parseCondition("明日の午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(result.dayType, "all", "全日（曜日指定なし）");
  assert.strictEqual(result.allowedWeekdays, undefined, "allowedWeekdaysは未定義");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/11-2026/10/11");
});

test("parseCondition - 来月の午後（全日として扱う）", () => {
  const result = parseCondition("来月の午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "all", "全日（曜日指定なし）");
  assert.strictEqual(result.allowedWeekdays, undefined, "allowedWeekdaysは未定義");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/11/1-2026/11/30");
});

test("parseCondition - 今月末までの午後（全日として扱う）", () => {
  const result = parseCondition("今月末までの午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(result.dayType, "all", "全日（曜日指定なし）");
  assert.strictEqual(result.allowedWeekdays, undefined, "allowedWeekdaysは未定義");
});

test("parseCondition - 水曜日の午後（水曜のみ）", () => {
  const result = parseCondition("水曜日の午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "specific", "特定の曜日");
  assert.ok(result.allowedWeekdays, "allowedWeekdaysが設定されている");
  assert.deepStrictEqual([...result.allowedWeekdays].sort(), ["水"], "水曜のみ");
});

test("parseCondition - 日曜除く（日曜以外）", () => {
  const result = parseCondition("日曜除く", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "all", "全日基準");
  assert.ok(result.excludedWeekdays, "excludedWeekdaysが設定されている");
  assert.deepStrictEqual(result.excludedWeekdays, ["日"], "日曜が除外されている");
});

test("parseCondition - 月曜〜水曜の範囲（月火水）", () => {
  const result = parseCondition("月曜〜水曜の午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "specific", "特定の曜日");
  assert.ok(result.allowedWeekdays, "allowedWeekdaysが設定されている");
  const days = new Set(result.allowedWeekdays);
  assert.ok(days.has("月"), "月が含まれる");
  assert.ok(days.has("火"), "火が含まれる");
  assert.ok(days.has("水"), "水が含まれる");
  assert.strictEqual(days.size, 3, "3つの曜日");
});

test("parseCondition - 月-金の範囲（月〜金）", () => {
  const result = parseCondition("月-金の午後", FIXED_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.dayType, "specific", "特定の曜日");
  assert.ok(result.allowedWeekdays, "allowedWeekdaysが設定されている");
  const days = new Set(result.allowedWeekdays);
  assert.ok(days.has("月"), "月が含まれる");
  assert.ok(days.has("火"), "火が含まれる");
  assert.ok(days.has("水"), "水が含まれる");
  assert.ok(days.has("木"), "木が含まれる");
  assert.ok(days.has("金"), "金が含まれる");
  assert.strictEqual(days.size, 5, "5つの曜日");
});

// ===== 候補生成のテスト =====

test("generateCandidateSlots: 今日開始の範囲で、今より前の枠だけが落ち、後の枠は残る", () => {
  // 2026-10-20 11:05 JST (火曜日)
  const now = new Date("2026-10-20T11:05:00+09:00");
  const parsed = parseCondition("10/20-10/22 10:00から20:00 2時間", now);
  assert.ok(parsed);
  assert.deepStrictEqual(parsed.rangeStart, new Date("2026-10-20T00:00:00+09:00"));
  assert.deepStrictEqual(parsed.rangeEnd, new Date("2026-10-23T00:00:00+09:00"));
  
  const slots = generateCandidateSlots(parsed, now, 20);
  
  // 10/20 10:00-12:00の開始時刻10:00は11:05より前なので、start <= nowで除外される
  // 残るのは、開始時刻が11:05より後の枠
  // 実際には、10/20は3個（範囲内で11:05より後の開始時刻）
  const slot10_20 = slots.filter(s => s.month === 10 && s.day === 20);
  assert.strictEqual(slot10_20.length, 3);
  
  // 開始時刻が11:05より後であることを確認
  slot10_20.forEach(s => {
    const slotStart = new Date(`2026-10-20T${String(s.startHour).padStart(2,'0')}:${String(s.startMinute).padStart(2,'0')}:00+09:00`);
    assert.ok(slotStart > now, `${s.startHour}:${s.startMinute}は11:05より後`);
  });
});

test("generateCandidateSlots: 火・木で、火曜と木曜の枠だけが生成される", () => {
  // 2026-10-20は火曜日
  const now = new Date("2026-10-20T11:05:00+09:00");
  const parsed = parseCondition("火・木 14:00から18:00 1時間", now);
  assert.ok(parsed);
  assert.strictEqual(parsed.dayType, "specific");
  assert.deepStrictEqual(parsed.allowedWeekdays?.sort(), ["木", "火"]);
  
  const slots = generateCandidateSlots(parsed, now, 20);
  
  // 曜日が火と木だけであることを確認
  const weekdays = slots.map(s => s.weekday);
  const uniqueWeekdays = [...new Set(weekdays)].sort();
  assert.deepStrictEqual(uniqueWeekdays, ["木", "火"]);
  
  // rangeStartはnow+24時間=10/21（水曜日）から始まるので、
  // 次の火曜日は10/27、次の木曜日は10/22
  const tue = slots.filter(s => s.weekday === "火");
  const thu = slots.filter(s => s.weekday === "木");
  assert.ok(tue.length > 0, "火曜の枠がある");
  assert.ok(thu.length > 0, "木曜の枠がある");
  assert.strictEqual(tue[0].day, 27, "最初の火曜は27日");
  assert.strictEqual(thu[0].day, 22, "最初の木曜は22日");
});

test("generateCandidateSlots: 月水金で、月曜・水曜・金曜の枠だけが生成される", () => {
  const now = new Date("2026-10-20T11:05:00+09:00"); // 月曜
  const parsed = parseCondition("月水金 10:00から12:00 1時間", now);
  assert.ok(parsed);
  assert.strictEqual(parsed.dayType, "specific");
  assert.deepStrictEqual(parsed.allowedWeekdays?.sort(), ["月", "水", "金"]);
  
  const slots = generateCandidateSlots(parsed, now, 20);
  
  const weekdays = slots.map(s => s.weekday);
  const uniqueWeekdays = [...new Set(weekdays)].sort();
  assert.deepStrictEqual(uniqueWeekdays, ["月", "水", "金"]);
});

test("generateCandidateSlots: 平日で、月〜金の枠だけが生成される", () => {
  const now = new Date("2026-10-20T11:05:00+09:00"); // 月曜
  const parsed = parseCondition("平日 10:00から18:00 2時間", now);
  assert.ok(parsed);
  assert.strictEqual(parsed.dayType, "weekday");
  
  const slots = generateCandidateSlots(parsed, now, 30);
  
  const weekdays = slots.map(s => s.weekday);
  const uniqueWeekdays = [...new Set(weekdays)].sort();
  assert.deepStrictEqual(uniqueWeekdays, ["月", "木", "水", "火", "金"]);
  
  // 土日が含まれていないこと
  assert.ok(!weekdays.includes("土"));
  assert.ok(!weekdays.includes("日"));
});

test("generateCandidateSlots: 土日を除くで、土日が除外される", () => {
  const now = new Date("2026-10-20T11:05:00+09:00");
  const parsed = parseCondition("土日を除く 14:00から20:00 2時間", now);
  assert.ok(parsed);
  // dayTypeは"weekday"（土日を除く=平日）
  assert.strictEqual(parsed.dayType, "weekday");
  assert.deepStrictEqual(parsed.excludedWeekdays?.sort(), ["土", "日"]);
  
  const slots = generateCandidateSlots(parsed, now, 30);
  
  // 生成された枠の曜日を確認
  const weekdays = slots.map(s => s.weekday);
  
  // 土日が含まれていないことを確認
  assert.ok(!weekdays.includes("土"), "土曜は含まれない");
  assert.ok(!weekdays.includes("日"), "日曜は含まれない");
  
  // 月〜金が含まれていること
  assert.ok(weekdays.includes("月"), "月曜が含まれる");
  assert.ok(weekdays.includes("火"), "火曜が含まれる");
  assert.ok(weekdays.includes("水"), "水曜が含まれる");
  assert.ok(weekdays.includes("木"), "木曜が含まれる");
  assert.ok(weekdays.includes("金"), "金曜が含まれる");
});

test("generateCandidateSlots: 日曜除くで、日曜だけが除外される", () => {
  const now = new Date("2026-10-20T11:05:00+09:00"); // 月曜
  const parsed = parseCondition("日曜除く 14:00から18:00 1時間", now);
  assert.ok(parsed);
  assert.strictEqual(parsed.dayType, "all");
  assert.deepStrictEqual(parsed.excludedWeekdays, ["日"]);
  
  const slots = generateCandidateSlots(parsed, now, 30);
  
  const weekdays = slots.map(s => s.weekday);
  assert.ok(!weekdays.includes("日"));
  
  // 他の曜日は含まれていること
  assert.ok(weekdays.includes("月"));
  assert.ok(weekdays.includes("火"));
  assert.ok(weekdays.includes("水"));
  assert.ok(weekdays.includes("木"));
  assert.ok(weekdays.includes("金"));
  assert.ok(weekdays.includes("土"));
});
