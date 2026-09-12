import { cn } from "@/lib/utils";

export function DragonMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0", className)}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* A tall, angular wing behind the dragon. */}
      <path
        fill="currentColor"
        d="M47 57c-9-4-17-10-24-18L10 23l15 5L17 10l17 13L31 4c9 9 15 20 18 32 5-8 11-14 18-19-2 13-8 24-18 32l-1 8Z"
      />
      {/* Long curling tail. */}
      <path
        fill="currentColor"
        d="M47 66c-7 9-16 16-27 20-8 3-15 3-21 0 4 9 16 13 29 8-6 4-11 7-15 9 13 1 25-5 35-15-3 7-3 12 0 16 6-8 9-17 8-27 5 8 11 13 19 14-6-7-11-13-16-17-4-3-8-6-12-8Z"
      />
      {/* Dragon body, curved neck, and profile head. */}
      <path
        fill="currentColor"
        d="M42 70c-6-7-7-14-3-22 3-6 8-11 10-16 2-5 1-9-3-12 5-4 11-4 15-1 4 3 5 7 3 12-2 5-3 10 0 15 3 6 8 9 14 11-3 7-9 12-16 14-8 2-15 1-20-1Z"
      />
      {/* Long snout and open lower jaw. */}
      <path
        fill="currentColor"
        d="M58 24c7-2 18 0 34 5l-13 5-17-2-9-4 5-4Z"
      />
      <path
        fill="currentColor"
        d="M57 31 83 38c-8 3-16 1-24-3l-7-3 5-1Z"
      />
      {/* Two horns and a short row of dragon spines. */}
      <path
        fill="currentColor"
        d="M55 24 51 12l8 9 4-12 2 14-5 5-5-4Z"
      />
      <path
        fill="currentColor"
        d="M45 31 38 26l2 8-8-2 7 7 7-3 3-5-4 0Z"
      />
      <path
        d="M58 27c5 0 10 1 14 3M57 33c5 2 10 2 15 1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity=".45"
      />
      {/* Small eye detail makes the profile read immediately as a dragon. */}
      <circle cx="61" cy="26" r="1.1" fill="#111827" />
    </svg>
  );
}