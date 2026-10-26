import { useState } from "react";
import { MapPicker } from "@/components/MapPicker";
import type { Pin } from "@/lib/delivery";
import { GEO_HELP, locate, type GeoFailure } from "@/lib/geo";
import { describePlace } from "@/lib/places";
import { cn } from "@/lib/utils";

/** The name of a spot, or nothing if it takes more than a few seconds: it only ever fills a form field, so it must never make anyone wait. */
const nameOf = (lat: number, lng: number): Promise<string | null> => Promise.race([describePlace(lat, lng), new Promise<null>((r) => setTimeout(() => r(null), 4500))]);

/**
 * Share where you are so the rider can navigate to the exact spot. Two ways, because either can fail on its own:
 * "Use my current location" asks the phone, and "Choose on the map" needs no GPS at all (search for a building, or drag a pin onto the spot).
 * Whichever is used, the place is also NAMED, and handed to `onChange` so the address field can be filled in.
 * When the phone cannot say where it is, the screen says why in plain words and puts the map first. Nothing here ever blocks an order.
 */
export function LocationPinButton({
  value,
  onChange,
  disabled,
  className,
  canRemove = true,
}: {
  value: Pin | null;
  onChange: (pin: Pin | null, place?: string | null) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  /** Hide the remove button where a saved pin cannot be taken back (the order page). */
  canRemove?: boolean;
}) {
  const [state, setState] = useState<"idle" | "locating">("idle");
  const [failure, setFailure] = useState<GeoFailure | null>(null);
  const [map, setMap] = useState(false);
  const [place, setPlace] = useState<string | null>(null);

  const here = async () => {
    setState("locating");
    setFailure(null);
    const r = await locate();
    if (!r.ok) {
      setState("idle");
      setFailure(r.reason);
      return;
    }
    const label = await nameOf(r.where.lat, r.where.lng);
    setState("idle");
    setPlace(label);
    await onChange(r.where, label);
  };

  const rough = value?.accuracy != null && value.accuracy > 150;
  const busy = state === "locating";
  const btn = "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 font-body text-sm font-medium transition-colors disabled:opacity-60";

  return (
    <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2", className)}>
      {value ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5 font-body text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-start gap-2 text-success">
              <i aria-hidden className="bx bx-check-circle mt-0.5 shrink-0 text-xl" />
              <span className="min-w-0">
                <span className="block">Location saved</span>
                {place && <span className="block truncate text-xs text-muted-foreground">{place}</span>}
                {value.accuracy != null && !place && <span className="block text-xs text-muted-foreground">within about {value.accuracy} m</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <button type="button" disabled={disabled} onClick={() => setMap(true)} className="min-h-10 rounded-lg px-2 text-foreground underline-offset-4 hover:underline disabled:opacity-50">
                Change
              </button>
              {canRemove && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setPlace(null);
                    void onChange(null, null);
                  }}
                  aria-label="Remove my location"
                  className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <i aria-hidden className="bx bx-x text-xl" />
                </button>
              )}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={disabled || busy} onClick={() => void here()} className={cn(btn, failure ? "border-border bg-transparent" : "border-border bg-secondary/40 hover:bg-secondary")}>
            <i aria-hidden className={cn("bx text-xl", busy ? "bx-loader-alt animate-spin" : "bx-current-location")} />
            {busy ? "Finding you…" : "Use my current location"}
          </button>
          <button type="button" disabled={disabled} onClick={() => setMap(true)} className={cn(btn, failure ? "border-primary bg-primary text-primary-foreground hover:opacity-90" : "border-border bg-transparent hover:bg-secondary")}>
            <i aria-hidden className="bx bx-map-pin text-xl" /> Choose on the map
          </button>
        </div>
      )}
      {rough && <p className="font-body text-xs text-warning">That is not very exact. Tap Change and drag the pin onto your door, or move outside and try again.</p>}
      {failure && (
        <p role="alert" className="font-body text-xs text-muted-foreground">
          {GEO_HELP[failure]}
        </p>
      )}
      {map && (
        <MapPicker
          title="Where should the rider come?"
          initial={value && !(value.lat === 0 && value.lng === 0) ? { lat: value.lat, lng: value.lng } : null}
          onClose={() => setMap(false)}
          onPick={(p) => {
            setMap(false);
            setFailure(null);
            setPlace(p.label ?? null);
            void onChange({ lat: p.lat, lng: p.lng, accuracy: null }, p.label ?? null);
          }}
        />
      )}
    </div>
  );
}
