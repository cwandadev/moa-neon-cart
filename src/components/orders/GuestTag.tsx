/** A small "Guest" label for an order placed without an account (so staff do not mistake it for a registered customer). */
export function GuestTag({ show }: { show?: boolean | null | undefined }) {
  if (!show) return null;
  return (
    <span className="ml-2 inline-flex rounded-full bg-muted px-2 py-0.5 align-middle font-body text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      Guest
    </span>
  );
}
