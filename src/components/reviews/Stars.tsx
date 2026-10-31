import { useState, type KeyboardEvent } from "react";
import { RATING_WORDS } from "@/lib/reviews";
import { cn } from "@/lib/utils";

const PATH = "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z";
function Row({ size, className }: { size: number; className: string }) {
  return (
    <span aria-hidden className={cn("flex", className)} style={{ width: size * 5 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className="shrink-0">
          <path d={PATH} />
        </svg>
      ))}
    </span>
  );
}

/** Stars for a rating, filled to the exact amount (4.6 fills most of the fifth star). Read aloud as "4.6 out of 5 stars". */
export function Stars({ value, size = 16, className }: { value: number; size?: number; className?: string }) {
  const v = Math.max(0, Math.min(5, value));
  return (
    <span role="img" aria-label={`${v.toFixed(1)} out of 5 stars`} className={cn("relative inline-flex shrink-0", className)} style={{ width: size * 5, height: size }}>
      <Row size={size} className="absolute inset-0 text-muted-foreground/30" />
      <span aria-hidden data-fill className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${(v / 5) * 100}%` }}>
        <Row size={size} className="text-warning" />
      </span>
    </span>
  );
}

/** Five stars to choose from. Tap, or use the arrow keys; the word beside them says what the choice means. */
export function StarInput({ value, onChange, label = "Your rating" }: { value: number; onChange: (v: number) => void; label?: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  const key = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange(Math.min(5, (value || n) + 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange(Math.max(1, (value || n) - 1));
    else return;
    e.preventDefault();
  };
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label={label} className="flex" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}, ${RATING_WORDS[n]}`}
            tabIndex={value === n || (value === 0 && n === 1) ? 0 : -1}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            onKeyDown={(e) => key(e, n)}
            className="grid size-11 place-items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg viewBox="0 0 24 24" width="30" height="30" fill={n <= shown ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" className={n <= shown ? "text-warning" : "text-muted-foreground/50"}>
              <path d={PATH} />
            </svg>
          </button>
        ))}
      </div>
      <span aria-live="polite" className="min-w-20 font-body text-sm text-muted-foreground">
        {shown ? RATING_WORDS[shown] : "Tap a star"}
      </span>
    </div>
  );
}
