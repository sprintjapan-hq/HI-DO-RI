import { parseCondition, generateCandidateSlots } from "../src/routes/condition-parser";

const now = new Date("2024-11-26T10:00:00+09:00");
const parsed = parseCondition("12月1日から4日の間の午後", now);

console.log("parsed:", JSON.stringify(parsed, null, 2));

const slots = generateCandidateSlots(parsed, now);
console.log(`\nGenerated ${slots.length} slots:`);
slots.forEach((slot, i) => {
  console.log(`${i + 1}. ${slot.month}/${slot.day}(${slot.weekday}) ${slot.startHour}:${String(slot.startMinute).padStart(2, '0')}`);
});

const days = [...new Set(slots.map(slot => slot.day))];
console.log("\nUnique days:", days);
