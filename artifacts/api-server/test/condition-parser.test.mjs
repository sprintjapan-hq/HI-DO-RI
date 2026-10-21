import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCondition, tokyoOffsetDate } from "../src/routes/condition-parser.ts";

/**
 * condition-parser.ts 年推論バグ修正のテスト
 * 
 * 基準日: 2026年10月21日 (火)
 * 
 * バグ症状:
 * 年なし期間（例: 10/20-10/25）で、開始日が基準日より前だと、
 * 終わりの日がまだ未来なのに、まるごと翌年として扱われていた。
 */

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

function formatDateRange(start, end) {
  if (!start || !end) return null;
  const startParts = tokyoDateParts(start);
  const endParts = tokyoDateParts(new Date(end.getTime() - 1));
  return `${startParts.year}/${startParts.month}/${startParts.day}-${endParts.year}/${endParts.month}/${endParts.day}`;
}

// 基準日: 2026年10月21日 (火) 午前10時 JST
const BASE_NOW = new Date("2026-10-21T10:00:00+09:00");

test("年なし期間: 開始日が昨日、終わりが未来 → 今年として扱う（バグ修正）", () => {
  // 10/20-10/25で、基準日が10/21のとき
  // 開始日10/20は昨日だが、終わり10/25はまだ未来なので、今年2026年として扱うべき
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
  // 10/10-10/20で、基準日が10/21のとき
  // 終わり10/20が昨日なので、完全に過去。翌年2027年として扱う
  const result = parseCondition("10/10-10/20の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2027/10/10-2027/10/20", "翌年2027年として解釈");
});

test("年なし期間: 終わりの日が今日 → 今年として扱う（境界条件）", () => {
  // 10/15-10/21で、基準日が10/21のとき
  // 終わり10/21は今日なので、今年として扱う
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
  // 10/20で、基準日が10/21のとき
  // 単一日付が過去なら翌年として扱う（従来動作）
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

test("年なし単一日付: 未来の日付は今年（従来の動作を維持）", () => {
  const result = parseCondition("10/25", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/25-2026/10/25", "今年2026年として解釈");
});

test("年なし期間: 月をまたぐ場合（開始が昨日、終わりが来月）", () => {
  // 10/20-11/5で、基準日が10/21のとき
  // 開始は昨日だが、終わりが未来なので今年
  const result = parseCondition("10/20-11/5の午後", BASE_NOW);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/10/20-2026/11/5", "今年2026年として解釈");
});

test("年またぎ期間: 12/28-1/5を12/30に入力 → 今年12/28〜翌年1/5", () => {
  // 基準日: 2026年12月30日
  const now = new Date("2026-12-30T10:00:00+09:00");
  const result = parseCondition("12/28-1/5の午後", now);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 開始は今年12/28（過去だが終わりが未来なので今年）、終わりは翌年1/5
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/12/28-2027/1/5", "今年12/28から翌年1/5");
});

test("年またぎ期間: 12/28-1/5を1/3に入力 → 前年12/28〜今年1/5（開始は1/3にそろえる）", () => {
  // 基準日: 2027年1月3日
  const now = new Date("2027-01-03T10:00:00+09:00");
  const result = parseCondition("12/28-1/5の午後", now);
  assert.ok(result, "結果がnullではない");
  assert.strictEqual(result.invalidDateRange, false, "有効な日付範囲");
  // 終わり1/5は未来なので今年として解釈。開始12/28は前年だが終わりが今年なので前年12/28
  // ただし実際の候補生成時は今日1/3以降のみ
  assert.strictEqual(formatDateRange(result.rangeStart, result.rangeEnd), "2026/12/28-2027/1/5", "前年12/28から今年1/5");
});
