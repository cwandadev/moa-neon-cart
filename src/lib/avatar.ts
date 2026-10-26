import { supabase } from "@/lib/supabase";

/**
 * A profile photo: what to show, how to prepare a picture, and how to save or remove one.
 * What is shown is their own photo if they added one, else the photo from their Google account, else their initials.
 * A picture is cut to a square from the middle and shrunk to 256 px before it leaves the phone: it uploads quickly on mobile data,
 * it fits the 1 MB limit with room to spare, and re-drawing it also drops anything hidden inside the original (such as where it was taken).
 */
export const AVATAR_PX = 256;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const BUCKET = "avatars";

export type PhotoSources = { avatarUrl: string | null; googlePhoto: string | null };

export const photoOf = (u: PhotoSources | null | undefined): string | null => u?.avatarUrl ?? u?.googlePhoto ?? null;

export function initialsOf(first: string, last: string, email = ""): string {
  const letters = `${first.trim().charAt(0)}${last.trim().charAt(0)}`.toUpperCase();
  return letters.trim() !== "" ? letters : email.trim().charAt(0).toUpperCase() || "?";
}

/** The file's path inside the avatars folder, from its public address (so the old photo can be deleted when a new one is saved). */
export function pathFromUrl(url: string | null | undefined): string | null {
  const m = /\/storage\/v1\/object\/public\/avatars\/([^?#]+)/.exec(url ?? "");
  return m ? decodeURIComponent(m[1]!) : null;
}

/** Cuts the middle square out of a picture and shrinks it. Throws an Error whose message can be shown as it is. */
export async function prepareAvatar(file: Blob): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not a picture.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That picture is too big. Choose one under 20 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("We could not read that picture. Try a JPG or PNG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PX;
  canvas.height = AVATAR_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare pictures. Try another browser.");
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
  bitmap.close?.();
  const toBlob = (type: string, q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  // WebP is the smallest; a browser that cannot make one hands back a PNG, so ask for a JPEG instead.
  const webp = await toBlob("image/webp", 0.85);
  const out = webp && webp.type === "image/webp" ? webp : await toBlob("image/jpeg", 0.88);
  if (!out || out.size === 0) throw new Error("We could not prepare that picture. Try another one.");
  return out;
}

/** Saves a prepared picture as the person's photo, then deletes the one it replaces. */
export async function uploadAvatar(userId: string, blob: Blob, previousPath: string | null = null): Promise<void> {
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;          // a new name every time: nothing is overwritten, and nobody sees a stale cached photo
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "31536000" });
  if (up.error) throw new Error("The photo did not upload. Check your internet and try again.");
  const set = await supabase.rpc("set_my_avatar", { p_path: path });
  if (set.error) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw new Error("We could not save your photo. Try again.");
  }
  if (previousPath && previousPath !== path) await supabase.storage.from(BUCKET).remove([previousPath]);
}

/** Goes back to the Google photo, or to initials. */
export async function removeAvatar(currentPath: string | null): Promise<void> {
  const set = await supabase.rpc("set_my_avatar", { p_path: null });
  if (set.error) throw new Error("We could not remove your photo. Try again.");
  if (currentPath) await supabase.storage.from(BUCKET).remove([currentPath]);
}
