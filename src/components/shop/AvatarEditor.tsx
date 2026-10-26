import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar } from "@/components/Avatar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { pathFromUrl, prepareAvatar, removeAvatar, uploadAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";

const primary = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-display text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50";
const secondary = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-secondary/40 px-5 font-body text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50";

/** Choose a picture, see it as it will look, then save it. Their own photo, or Google's, or their initials: it says which one is showing. */
export function AvatarEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, refreshProfile } = useAuth();
  const [picked, setPicked] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<"" | "reading" | "saving" | "removing">("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPicked((p) => {
        if (p) URL.revokeObjectURL(p.url);
        return null;
      });
      setError("");
      setBusy("");
    }
  }, [open]);

  if (!user) return null;
  const ownPath = pathFromUrl(user.avatarUrl);
  const show = picked ? { ...user, avatarUrl: picked.url, googlePhoto: null } : user;

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setBusy("reading");
    try {
      const blob = await prepareAvatar(file);
      setPicked((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not use that picture.");
    } finally {
      setBusy("");
      if (input.current) input.current.value = "";
    }
  };
  const save = async () => {
    if (!picked) return;
    setBusy("saving");
    setError("");
    try {
      await uploadAvatar(user.id, picked.blob, ownPath);
      refreshProfile();
      toast.success("Photo saved.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not save your photo.");
      setBusy("");
    }
  };
  const remove = async () => {
    setBusy("removing");
    setError("");
    try {
      await removeAvatar(ownPath);
      refreshProfile();
      toast.success(user.googlePhoto ? "Your Google photo is showing again." : "Photo removed.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "We could not remove your photo.");
      setBusy("");
    }
  };

  const which = picked ? "This is how it will look." : user.avatarUrl ? "This is the photo you added." : user.googlePhoto ? "This is your Google photo. Add your own to replace it." : "Add a photo so we can show you instead of your initials.";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent aria-label="Profile photo" className="moa-sheet flex flex-col gap-0 overflow-hidden border-border bg-card p-0 max-md:rounded-b-none max-md:rounded-t-3xl md:max-w-sm">
        <div className="grid gap-5 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div>
            <DialogTitle className="font-display text-xl font-semibold">Profile photo</DialogTitle>
            <DialogDescription className="font-body text-sm text-muted-foreground">The middle of the picture is used, as a square.</DialogDescription>
          </div>
          <div className="grid justify-items-center gap-3">
            <Avatar user={show} size={112} />
            <p className="text-center font-body text-sm text-muted-foreground" aria-live="polite">
              {which}
            </p>
          </div>
          <input ref={input} type="file" accept="image/*" className="sr-only" aria-label="Choose a photo" onChange={(e) => void choose(e.target.files?.[0])} />
          {error && (
            <p role="alert" className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3 font-body text-sm text-destructive">
              {error}
            </p>
          )}
          {picked ? (
            <div className="grid gap-2">
              <button type="button" className={primary} disabled={busy !== ""} onClick={() => void save()}>
                {busy === "saving" ? "Saving…" : "Save photo"}
              </button>
              <button type="button" className={secondary} disabled={busy !== ""} onClick={() => input.current?.click()}>
                Choose another
              </button>
            </div>
          ) : (
            <div className="grid gap-2">
              <button type="button" className={primary} disabled={busy !== ""} onClick={() => input.current?.click()}>
                <i aria-hidden className="bx bx-image-add text-xl" /> {busy === "reading" ? "Preparing…" : user.avatarUrl ? "Choose a new photo" : "Choose a photo"}
              </button>
              {user.avatarUrl && (
                <button type="button" className={cn(secondary, "text-destructive")} disabled={busy !== ""} onClick={() => void remove()}>
                  {busy === "removing" ? "Removing…" : user.googlePhoto ? "Remove mine, use my Google photo" : "Remove my photo"}
                </button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A ready-made row for the account page: the photo, the name, and a button to change it. */
export function ProfilePhotoCard({ className }: { className?: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  return (
    <div className={cn("flex items-center gap-4 rounded-2xl border border-border bg-card p-4", className)}>
      <Avatar user={user} size={64} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-semibold">{`${user.firstName} ${user.lastName}`.trim() || "Your account"}</p>
        <p className="truncate font-body text-sm text-muted-foreground">{user.email}</p>
      </div>
      <button type="button" onClick={() => setOpen(true)} className="min-h-11 shrink-0 rounded-xl border border-border px-4 font-body text-sm font-medium hover:bg-secondary">
        Change photo
      </button>
      <AvatarEditor open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
