export function LoopgraphMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M14.3 25.7 25.7 14.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M16.5 30.5c-5.8 0-10.5-4.7-10.5-10.5S10.7 9.5 16.5 9.5c3 0 5.7 1.3 7.6 3.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <path
        d="M23.5 9.5c5.8 0 10.5 4.7 10.5 10.5S29.3 30.5 23.5 30.5c-3 0-5.7-1.3-7.6-3.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3"
      />
      <circle cx="20" cy="20" fill="currentColor" r="2.25" />
    </svg>
  );
}
