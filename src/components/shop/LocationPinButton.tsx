import { useState } from "react";
import { getPosition, type Pin } from "@/lib/delivery";
import { cn } from "@/lib/utils";

/**
 * "Use my current location": asks the phone for where it is, so the rider can navigate to the exact spot.
 * It only ever fills in a pin; the typed address stays, and a refusal never blocks anything.
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
  const [state, setState] = useState<"idle" | "locating" | "failed">("idle");

  const locate = async () => {
    setState("locating");
    const p = await getPosition(12000);
    if (!p) {
      setState("failed");
      return;
    }
    setState("idle");
    await onChange(p);
  };

  const rough = value?.accuracy != null && value.accuracy > 150;

  return (
    <div className={cn("grid gap-2", className)}>
      {value ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/10 px-3 py-2.5 font-body text-sm">
          <span className="flex min-w-0 items-center gap-2 text-success">
            <i aria-hidden className="bx bx-check-circle text-xl" />
            <span>
              Location saved
              {value.accuracy != null && <span className="text-muted-foreground"> · within about {value.accuracy} m</span>}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={disabled || state === "locating"} onClick={() => void locate()} className="min-h-10 rounded-lg px-2 text-foreground underline-offset-4 hover:underline disabled:opacity-50">
              {state === "locating" ? "Locating…" : "Update"}
            </button>
            {canRemove && (
              <button type="button" disabled={disabled} onClick={() => void onChange(null)} aria-label="Remove my location" className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-50">
                <i aria-hidden className="bx bx-x text-xl" />
              </button>
            )}
          </span>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled || state === "locating"}
          onClick={() => void locate()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 font-body text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-60"
        >
          <i aria-hidden className={cn("bx text-xl", state === "locating" ? "bx-loader-alt animate-spin" : "bx-current-location")} />
          {state === "locating" ? "Finding you…" : "Use my current location"}
        </button>
      )}
      {rough && <p className="font-body text-xs text-warning">That is not very exact. Move near a window or outside and tap Update, or just type the address.</p>}
      {state === "failed" && (
        <p role="alert" className="font-body text-xs text-muted-foreground">
          We could not get your location. You can allow it in your browser settings, or just type the address: that works too.
        </p>
      )}
    </div>
  );
}
