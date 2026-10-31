import { prepareAvatar } from "@/lib/avatar";
import { supabase } from "@/lib/supabase";

/**
 * A store's logo: where it is kept, how a picture is prepared, and how an admin saves or removes one.
 * A picture is cut to a square from the middle and shrunk to 256 px before it leaves the computer (the same preparation a profile photo gets), so it
 * uploads quickly, stays well under the 1 MB limit, and any hidden details of the original (such as where a photo was taken) are dropped.
 * Only an admin can upload (the folder's rules in the database say so), and the file's path is saved by one function that checks it.
 */
const BUCKET = "store-logos";

/** The public address of a logo, or null when the store has none (the page then shows a store icon). */
export const logoUrlOf = (path: string | null | undefined): string | null => (path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

/** Saves a picture as the store's logo, then deletes the one it replaces. Throws an Error whose message can be shown as it is. */
export async function uploadStoreLogo(warehouseId: string, file: Blob, previousPath: string | null = null): Promise<string> {
  const blob = await prepareAvatar(file);
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
  const path = `${warehouseId}/logo-${Date.now()}.${ext}`; // a new name every time: nothing is overwritten, and nobody sees a stale cached logo
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: "31536000" });
  if (up.error) throw new Error("The logo did not upload. Check your internet and try again.");
  const set = await supabase.rpc("admin_set_warehouse_logo", { p_id: warehouseId, p_path: path });
  if (set.error) {
    await supabase.storage.from(BUCKET).remove([path]); // do not leave a file nobody points to
    throw new Error(set.error.message);
  }
  if (previousPath && previousPath !== path) await supabase.storage.from(BUCKET).remove([previousPath]);
  return path;
}

/** Takes the logo off a store (it goes back to the store icon) and deletes the file. */
export async function removeStoreLogo(warehouseId: string, previousPath: string | null): Promise<void> {
  const set = await supabase.rpc("admin_set_warehouse_logo", { p_id: warehouseId, p_path: "" });
  if (set.error) throw new Error(set.error.message);
  if (previousPath) await supabase.storage.from(BUCKET).remove([previousPath]);
}
