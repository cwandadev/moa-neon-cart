import { useEffect, useState } from "react";
import { initialsOf, photoOf, type PhotoSources } from "@/lib/avatar";
import { cn } from "@/lib/utils";

type Who = PhotoSources & { firstName: string; lastName: string; email?: string };

/**
 * A round photo: their own, else Google's, else their initials on the brand colour.
 * A picture that fails to load (Google's can, from time to time) quietly becomes the initials instead of a broken image.
 * The photo is asked for without sending this page's address along, so the site that serves it learns nothing about where it is shown.
 */
export function Avatar({ user, size = 40, className }: { user: Who | null; size?: number; className?: string }) {
  const src = photoOf(user);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-primary/15 font-display font-semibold text-primary", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }}
    >
      {src && !failed ? (
        <img src={src} alt="" referrerPolicy="no-referrer" draggable={false} onError={() => setFailed(true)} className="size-full object-cover" />
      ) : (
        <span aria-hidden>{user ? initialsOf(user.firstName, user.lastName, user.email) : "?"}</span>
      )}
    </span>
  );
}
