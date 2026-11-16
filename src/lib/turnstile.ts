/**
 * Cloudflare Turnstile: the invisible "are you a person" check that Supabase can require before it lets anyone sign in, sign up, reset a password
 * or start a guest session. Without it, a script could create thousands of guest users in the database.
 *
 * `getCaptchaToken()` gives a fresh one-time token to send along with the sign-in call. The check runs in the background and only shows
 * something on screen (at the bottom of the page) if Cloudflare is not sure the visitor is a person.
 *
 * It is safe to ship before the check is switched on: with no site key set, or if Cloudflare's script cannot load, it returns undefined, and
 * the sign-in calls work exactly as they did before (Supabase only asks for the token once its "CAPTCHA protection" setting is turned on).
 */

type TurnstileApi = {
  render: (el: HTMLElement, o: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const LOAD_MS = 8000;
const CHECK_MS = 60000;

/** The public Site key from Cloudflare (the secret key lives only in Supabase). Read when used, so it can be set per environment. */
export const turnstileSiteKey = (): string => String(import.meta.env["VITE_TURNSTILE_SITE_KEY"] ?? "").trim();

let loading: Promise<boolean> | null = null;
/** Loads Cloudflare's script once. Resolves true when it is ready, false if it could not be loaded in time. */
export function loadTurnstile(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(false);
  if (window.turnstile) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      if (!ok) loading = null; // a later try may work
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), LOAD_MS);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => done(Boolean(window.turnstile));
    s.onerror = () => done(false);
    document.head.appendChild(s);
  });
  return loading;
}

/** A fresh one-time token, or undefined when the check is not set up or could not run. */
export async function getCaptchaToken(): Promise<string | undefined> {
  const sitekey = turnstileSiteKey();
  if (!sitekey) return undefined;
  if (!(await loadTurnstile())) return undefined;
  const api = window.turnstile;
  if (!api) return undefined;
  return new Promise<string | undefined>((resolve) => {
    const box = document.createElement("div");
    box.setAttribute("data-turnstile-box", "");
    box.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647";
    document.body.appendChild(box);
    let id: string | undefined;
    let settled = false;
    const end = (token?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        if (id) api.remove(id);
      } catch {
        /* already gone */
      }
      box.remove();
      resolve(token);
    };
    const timer = window.setTimeout(() => end(undefined), CHECK_MS);
    try {
      id = api.render(box, {
        sitekey,
        // Invisible unless Cloudflare needs the person to do something.
        appearance: "interaction-only",
        callback: (token: string) => end(token),
        "error-callback": () => end(undefined),
        "timeout-callback": () => end(undefined),
      });
    } catch {
      end(undefined);
    }
  });
}

/** The same, shaped for the sign-in calls: { captchaToken } when there is one, and nothing at all when there is not. */
export async function captchaOptions(): Promise<{ captchaToken?: string }> {
  const token = await getCaptchaToken();
  return token ? { captchaToken: token } : {};
}
