import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { CATEGORIES, money, type Category } from "@/lib/products";
import { cn } from "@/lib/utils";

export type Filters = {
  categories: Category[];
  price: [number, number];
  inStockOnly: boolean;
  minRating: number;
  sort: "smart" | "new" | "price-asc" | "price-desc" | "rating";
};

export const defaultFilters: Filters = {
  categories: [],
  price: [0, 1500],
  inStockOnly: false,
  minRating: 0,
  sort: "smart",
};

const sorts: { id: Filters["sort"]; label: string }[] = [
  { id: "smart", label: "Smart feed" },
  { id: "new", label: "Newest" },
  { id: "price-asc", label: "Price ↑" },
  { id: "price-desc", label: "Price ↓" },
  { id: "rating", label: "Top rated" },
];

export function FilterBar({
  open,
  onOpenChange,
  filters,
  onChange,
  resultCount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  filters: Filters;
  onChange: (f: Filters) => void;
  resultCount: number;
}) {
  const toggleCategory = (c: Category) =>
    onChange({
      ...filters,
      categories: filters.categories.includes(c)
        ? filters.categories.filter((x) => x !== c)
        : [...filters.categories, c],
    });

  const activeCount =
    filters.categories.length +
    (filters.inStockOnly ? 1 : 0) +
    (filters.minRating > 0 ? 1 : 0) +
    (filters.price[0] > 0 || filters.price[1] < 1500 ? 1 : 0);

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="glass" className="rounded-xl font-body" onClick={() => onOpenChange(!open)}>
            <i className={cn("text-lg", open ? "bx bx-x" : "bx bx-slider-alt")} />
            Filters
            {activeCount > 0 && (
              <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
          <span className="font-body text-xs text-muted-foreground">{resultCount} products</span>
        </div>

        <div className="no-scrollbar -mx-1 flex max-w-full items-center gap-1 overflow-x-auto px-1">
          {sorts.map((s) => (
            <button
              key={s.id}
              onClick={() => onChange({ ...filters, sort: s.id })}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 font-body text-xs transition-colors",
                filters.sort === s.id
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="mt-4 grid gap-6 rounded-2xl border border-border bg-card/50 p-5 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="mb-3 font-display text-xs uppercase tracking-widest text-muted-foreground">
              Category
            </p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 font-body text-xs transition-colors",
                    filters.categories.includes(c)
                      ? "border-accent/50 bg-accent/15 text-accent"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-3 font-display text-xs uppercase tracking-widest text-muted-foreground">
              Price range
            </p>
            <Slider
              value={filters.price}
              min={0}
              max={1500}
              step={10}
              onValueChange={(v) => onChange({ ...filters, price: [v[0] ?? 0, v[1] ?? 1500] })}
            />
            <p className="mt-3 font-body text-xs text-muted-foreground">
              {money(filters.price[0])} — {money(filters.price[1])}
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="instock" className="font-body text-sm text-muted-foreground">
                In stock only
              </Label>
              <Switch
                id="instock"
                checked={filters.inStockOnly}
                onCheckedChange={(v) => onChange({ ...filters, inStockOnly: v })}
              />
            </div>
            <div>
              <p className="mb-2 font-display text-xs uppercase tracking-widest text-muted-foreground">
                Rating
              </p>
              <div className="flex gap-1.5">
                {[0, 3, 4, 4.5].map((r) => (
                  <button
                    key={r}
                    onClick={() => onChange({ ...filters, minRating: r })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-body text-xs transition-colors",
                      filters.minRating === r
                        ? "border-chart-3/50 bg-chart-3/15 text-chart-3"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {r === 0 ? "All" : `${r}+`}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" className="font-body" onClick={() => onChange(defaultFilters)}>
              <i className="bx bx-reset text-base" /> Reset filters
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}