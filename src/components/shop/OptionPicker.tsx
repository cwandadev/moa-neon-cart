import type { ProductVariant } from "@/lib/products";
import { cn } from "@/lib/utils";

const isColorName = (n: string) => /^colou?rs?$/i.test(n.trim());

/** One row of choices (for example Size or Color). Sold-out values stay visible but disabled. */
export function OptionGroup({
  name,
  which,
  values,
  selected,
  otherSelected,
  variants,
  onSelect,
}: {
  name: string;
  which: 1 | 2;
  values: string[];
  selected: string;
  otherSelected: string;
  variants: ProductVariant[];
  onSelect: (value: string) => void;
}) {
  const color = isColorName(name);
  const valueOf = (v: ProductVariant) => (which === 1 ? v.option1 : v.option2);
  const otherOf = (v: ProductVariant) => (which === 1 ? v.option2 : v.option1);
  const matching = (value: string) =>
    variants.filter((v) => valueOf(v) === value && (otherSelected === "" || otherOf(v) === otherSelected));

  return (
    <div>
      <p className="mb-2 font-display text-sm font-semibold">
        {name}: <span className="font-normal text-muted-foreground">{selected || "Select"}</span>
      </p>
      <div className="flex flex-wrap gap-2.5">
        {values.map((value) => {
          const rows = matching(value);
          const left = rows.reduce((n, v) => n + v.stock, 0);
          const ok = left > 0;
          const on = selected === value;

          if (color) {
            const swatch = rows[0]?.swatch ?? variants.find((v) => valueOf(v) === value)?.swatch ?? "#888888";
            return (
              <button
                key={value}
                type="button"
                aria-label={`${name}: ${value}${ok ? "" : " (sold out)"}`}
                aria-pressed={on}
                onClick={() => onSelect(value)}
                className={cn(
                  "relative size-10 rounded-full border border-border p-0.5 transition-shadow",
                  on && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                  !ok && "opacity-40",
                )}
              >
                <span className="block size-full rounded-full" style={{ backgroundColor: swatch }} />
                {!ok && (
                  <span className="absolute inset-0 grid place-items-center">
                    <span className="h-px w-full rotate-45 bg-foreground/80" />
                  </span>
                )}
              </button>
            );
          }

          return (
            <div key={value} className="flex flex-col items-center gap-1">
              <button
                type="button"
                disabled={!ok}
                aria-pressed={on}
                onClick={() => onSelect(value)}
                className={cn(
                  "min-h-11 min-w-12 rounded-xl border px-3.5 font-body text-sm transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-foreground hover:border-primary/60",
                  !ok && "cursor-not-allowed text-muted-foreground line-through opacity-50 hover:border-border",
                )}
              >
                {value}
              </button>
              {ok && left <= 3 && <span className="font-body text-[10px] text-warning">{left} left</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
