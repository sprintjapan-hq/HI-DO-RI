import { test } from "node:test";
import assert from "node:assert";
import { parseCandidateLabelTime } from "../src/lib/candidate-label-time";

test("parseCandidateLabelTime: 完全な時間範囲 (12/1(火) 15:00〜16:00)", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  const result = parseCandidateLabelTime("12/1(火) 15:00〜16:00", referenceDate);
  
  assert.ok(result, "パース結果がnullではないこと");
  assert.ok(result.startAt instanceof Date, "startAtがDate型であること");
  assert.ok(result.endAt instanceof Date, "endAtがDate型であること");
  
  // 2024/12/1 15:00 JST = 2024/12/1 06:00 UTC
  assert.strictEqual(result.startAt.toISOString(), "2024-12-01T06:00:00.000Z");
  // 2024/12/1 16:00 JST = 2024/12/1 07:00 UTC
  assert.strictEqual(result.endAt.toISOString(), "2024-12-01T07:00:00.000Z");
});

test("parseCandidateLabelTime: 開始時刻のみ (12/1(火) 15:00) → 60分後をデフォルト終了時刻とする", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  const result = parseCandidateLabelTime("12/1(火) 15:00", referenceDate);
  
  assert.ok(result, "パース結果がnullではないこと");
  assert.ok(result.startAt instanceof Date, "startAtがDate型であること");
  assert.ok(result.endAt instanceof Date, "endAtがDate型であること");
  
  // 2024/12/1 15:00 JST = 2024/12/1 06:00 UTC
  assert.strictEqual(result.startAt.toISOString(), "2024-12-01T06:00:00.000Z");
  // 2024/12/1 16:00 JST = 2024/12/1 07:00 UTC (60分後)
  assert.strictEqual(result.endAt.toISOString(), "2024-12-01T07:00:00.000Z");
});

test("parseCandidateLabelTime: 年付き完全形式 (2024/12/1(火) 15:00〜16:00)", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  const result = parseCandidateLabelTime("2024/12/1(火) 15:00〜16:00", referenceDate);
  
  assert.ok(result, "パース結果がnullではないこと");
  assert.strictEqual(result.startAt.toISOString(), "2024-12-01T06:00:00.000Z");
  assert.strictEqual(result.endAt.toISOString(), "2024-12-01T07:00:00.000Z");
});

test("parseCandidateLabelTime: 年付き開始時刻のみ (2024/12/1(火) 15:00)", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  const result = parseCandidateLabelTime("2024/12/1(火) 15:00", referenceDate);
  
  assert.ok(result, "パース結果がnullではないこと");
  assert.strictEqual(result.startAt.toISOString(), "2024-12-01T06:00:00.000Z");
  assert.strictEqual(result.endAt.toISOString(), "2024-12-01T07:00:00.000Z");
});

test("parseCandidateLabelTime: 曜日なし (12/1 15:00〜16:00)", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  const result = parseCandidateLabelTime("12/1 15:00〜16:00", referenceDate);
  
  assert.ok(result, "パース結果がnullではないこと");
  assert.strictEqual(result.startAt.toISOString(), "2024-12-01T06:00:00.000Z");
  assert.strictEqual(result.endAt.toISOString(), "2024-12-01T07:00:00.000Z");
});

test("parseCandidateLabelTime: 曜日なし開始時刻のみ (12/1 15:00)", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  const result = parseCandidateLabelTime("12/1 15:00", referenceDate);
  
  assert.ok(result, "パース結果がnullではないこと");
  assert.strictEqual(result.startAt.toISOString(), "2024-12-01T06:00:00.000Z");
  assert.strictEqual(result.endAt.toISOString(), "2024-12-01T07:00:00.000Z");
});

test("parseCandidateLabelTime: 自由記述ラベルはnullを返す", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  
  assert.strictEqual(parseCandidateLabelTime("来週の火曜日", referenceDate), null);
  assert.strictEqual(parseCandidateLabelTime("午後の都合の良い時間", referenceDate), null);
  assert.strictEqual(parseCandidateLabelTime("12月1日", referenceDate), null);
});

test("parseCandidateLabelTime: 無効な日付はnullを返す", () => {
  const referenceDate = new Date("2024-11-26T10:00:00+09:00");
  
  assert.strictEqual(parseCandidateLabelTime("13/1(火) 15:00", referenceDate), null); // 月が無効
  assert.strictEqual(parseCandidateLabelTime("12/32(火) 15:00", referenceDate), null); // 日が無効
  assert.strictEqual(parseCandidateLabelTime("12/1(火) 25:00", referenceDate), null); // 時が無効
});
