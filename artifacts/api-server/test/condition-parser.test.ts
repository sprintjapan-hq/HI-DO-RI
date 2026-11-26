import { test } from "node:test";
import assert from "node:assert";
import { parseCondition, generateCandidateSlots } from "../src/routes/condition-parser";

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
