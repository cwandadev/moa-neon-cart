import { useState } from "react";
import { MapPicker } from "@/components/MapPicker";
import type { Pin } from "@/lib/delivery";
import { GEO_HELP, locate, type GeoFailure } from "@/lib/geo";
import { cn } from "@/lib/utils";

/**
 * Share where you are so the rider can navigate to the exact spot. Two ways, because either can fail on its own:
 * "Use my current location" asks the phone, and "Choose on the map" needs no GPS at all (drag a pin onto the spot).
 * When the phone cannot say where it is, the screen says why in plain words and puts the map first.
 * The typed address always stays, and nothing here ever blocks an order.
 */
export function LocationPinButton({
  value,
  onChange,
  disabled,
  className,
  canRemove = true,
}: {
  value: Pin | null;
  onChange: (pin: Pin | null) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
  /** Hide the remove button where a saved pin cannot be taken back (the order page). */
  canRemove?: boolean;
}) {
  const [state, setState] = useState<"idle" | "locating">("idle");
  const [failure, setFailure] = useState<GeoFailure | null>(null);
  const [map, setMap] = useState(false);

  const here = async () => {
    setState("locating");
    setFailure(null);
    const r = await locate();
    setState("idle");
    if (!r.ok) {
      setFailure(r.reason);
      return;
    }
    await onChange(r.where);
  };

  const rough = value?.accuracy != null && value.accuracy > 150;
  const busy = state === "locating";
  const btn = "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border px-3 font-body text-sm font-medium transition-colors disabled:opacity-60";

  return (
    <div className={cn("grid gap-2", className)}>
      {value ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5 font-body text-sm">
          <span className="flex min-w-0 items-center gap-2 text-success">
            <i aria-hidden className="bx bx-check-circle text-xl" />
            <span>
              Location saved
              {value.accuracy != null && <span className="text-muted-foreground"> · within about {value.accuracy} m</span>}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={disabled || busy} onClick={() => void here()} className="min-h-10 rounded-lg px-2 text-foreground underline-offset-4 hover:underline disabled:opacity-50">
              {busy ? "Locating…" : "Update"}
            </button>
            <button type="button" disabled={disabled} onClick={() => setMap(true)} className="min-h-10 rounded-lg px-2 text-foreground underline-offset-4 hover:underline disabled:opacity-50">
              Change on the map
            </button>
            {canRemove && (
              <button type="button" disabled={disabled} onClick={() => void onChange(null)} aria-label="Remove my location" className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-50">
                <i aria-hidden className="bx bx-x text-xl" />
              </button>
            )}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={disabled || busy} onClick={() => void here()} className={cn(btn, failure ? "border-border bg-transparent" : "border-border bg-secondary/40 hover:bg-secondary")}>
            <i aria-hidden className={cn("bx text-xl", busy ? "bx-loader-alt animate-spin" : "bx-current-location")} />
            {busy ? "Finding you…" : "Use my current location"}
          </button>
          <button type="button" disabled={disabled} onClick={() => setMap(true)} className={cn(btn, failure ? "border-white bg-white text-black" : "border-border bg-transparent hover:bg-secondary")}>
            <i aria-hidden className="bx bx-map-pin text-xl" /> Choose on the map
          </button>
        </div>
      )}
      {rough && <p className="font-body text-xs text-warning">That is not very exact. Move near a window or outside and tap Update, or choose it on the map.</p>}
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
            void onChange({ lat: p.lat, lng: p.lng, accuracy: null });
          }}
        />
      )}
    </div>
  );
}
