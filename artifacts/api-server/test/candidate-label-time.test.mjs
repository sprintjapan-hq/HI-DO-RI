import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCandidateLabelTime, resolveCandidateTime } from "../src/lib/candidate-label-time.ts";

const createdAt = new Date("2026-10-27T04:16:50.981Z");
for (const label of [
  "2026/11/2(月) 14:00〜16:00",
  "11/2(月) 14:00-16:00",
  "２０２６/１１/２（月） １４：００～１６：００",
  "2026/11/2 14:00–16:00",
]) {
  test(`label resolves Tokyo time: ${label}`, () => {
    const result = parseCandidateLabelTime(label, createdAt);
    assert.equal(result?.startAt.toISOString(), "2026-11-02T05:00:00.000Z");
    assert.equal(result?.endAt.toISOString(), "2026-11-02T07:00:00.000Z");
  });
}
for (const label of [
  "2026/2/29(日) 14:00-16:00",
  "2026/13/2(月) 14:00-16:00",
  "2026/11/31(月) 14:00-16:00",
  "2026/11/2(月) 24:00-25:00",
  "2026/11/2(月) 14:60-16:00",
  "2026/11/2(月) 16:00-14:00",
  "2026/11/2(月) 14:00-14:00",
  "候補A",
  "相談 2026/11/2(月) 14:00-16:00",
]) {
  test(`unsafe or ambiguous label does not match: ${label}`, () => {
    assert.equal(parseCandidateLabelTime(label, createdAt), null);
  });
}
test("yearless labels use the poll creation year in Tokyo, including the year boundary", () => {
  assert.equal(parseCandidateLabelTime("11/2(月) 14:00-16:00", createdAt).startAt.getUTCFullYear(), 2026);
  assert.equal(parseCandidateLabelTime("1/2(金) 14:00-16:00", new Date("2025-12-31T16:00:00Z")).startAt.getUTCFullYear(), 2026);
});
test("explicit year does not depend on the reference year and leap days validate", () => {
  assert.equal(parseCandidateLabelTime("2028/2/29(火) 14:00-16:00", createdAt).startAt.toISOString(), "2028-02-29T05:00:00.000Z");
});
test("stored times take priority over labels and a single missing time is recovered", () => {
  const startAt = new Date("2026-11-02T05:00:00Z");
  const endAt = new Date("2026-11-02T07:00:00Z");
  assert.deepEqual(resolveCandidateTime({ label: "候補A", startAt, endAt }, createdAt), { startAt, endAt });
  assert.deepEqual(resolveCandidateTime({ label: "11/2(月) 14:00-16:00", startAt, endAt: null }, createdAt), { startAt, endAt });
  assert.deepEqual(resolveCandidateTime({ label: "11/2(月) 14:00-16:00", startAt: null, endAt }, createdAt), { startAt, endAt });
  assert.equal(resolveCandidateTime({ label: "候補A", startAt: null, endAt: null }, createdAt), null);
});
