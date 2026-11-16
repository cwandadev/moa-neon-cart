import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { captchaOptions } from "@/lib/turnstile";

/**
 * Sign in with Google's own button.
 *
 * The old button sent people to Google by way of the shop's Supabase address, so the Google screen said "to continue to <project>.supabase.co".
 * Google's own button does not go through that screen: the person picks an account in Google's own window, Google hands the shop a signed
 * token, and Supabase checks it (signInWithIdToken). It is Supabase's documented way, and it needs nothing extra but a public Client ID.
 *
 * Nothing here can leave the page without a way in: with no Client ID set, if Google's script does not load (a blocker, a bad connection,
 * an in-app browser), or if the button cannot be drawn, the old button (the `fallback`) is shown instead.
 */

type Credential = { credential: string };
type GoogleId = {
  initialize: (o: { client_id: string; callback: (r: Credential) => void; nonce: string; use_fedcm_for_prompt: boolean; auto_select: boolean; cancel_on_tap_outside: boolean }) => void;
  renderButton: (el: HTMLElement, o: { type: string; theme: string; size: string; text: string; shape: string; logo_alignment: string; width: number }) => void;
};
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SRC = "https://accounts.google.com/gsi/client";
const GIVE_UP_MS = 8000;

/** The public Client ID of the Google "Web application" client (the same one Supabase has). Read when used, so it can be set per environment. */
export const googleClientId = (): string => String(import.meta.env["VITE_GOOGLE_CLIENT_ID"] ?? "").trim();

let loading: Promise<boolean> | null = null;
/** Loads Google's script once. Resolves true when it is ready, false if it could not be loaded in time. */
export function loadGoogleScript(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.google?.accounts?.id) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      if (!ok) loading = null; // a later visit may try again
      resolve(ok);
    };
    const timer = window.setTimeout(() => done(false), GIVE_UP_MS);
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => done(Boolean(window.google?.accounts?.id));
    s.onerror = () => done(false);
    document.head.appendChild(s);
  });
  return loading;
}

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A fresh random nonce: Google gets the SHA-256 of it, Supabase gets the original, and Supabase checks they match (so a stolen token is useless). */
export async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const hashed = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  return { raw, hashed };
}

export function GoogleSignIn({ fallback }: { fallback: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [state, setState] = useState<"loading" | "ready" | "unavailable">(googleClientId() ? "loading" : "unavailable");
  const [error, setError] = useState("");

  useEffect(() => {
    const clientId = googleClientId();
    if (!clientId) return undefined;
    let dead = false;
    void (async () => {
      try {
        if (!(await loadGoogleScript())) throw new Error("script");
        const nonce = await makeNonce();
        const el = box.current;
        const gid = window.google?.accounts.id;
        if (dead || !el || !gid) return;
        gid.initialize({
          client_id: clientId,
          nonce: nonce.hashed,
          use_fedcm_for_prompt: true,
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: ({ credential }) => {
            setError("");
            void captchaOptions()
              .then((options) => supabase.auth.signInWithIdToken({ provider: "google", token: credential, nonce: nonce.raw, options }))
              .then(({ error: e }) => {
              if (e) {
                console.error("Google sign-in failed:", e.message);
                setError("Google sign-in did not work. Please try again, or use your email.");
                return;
              }
              void navigate({ to: "/" }); // the same place the old button led to
            });
          },
        });
        const room = el.parentElement?.clientWidth || 320;
        gid.renderButton(el, { type: "standard", theme: "filled_black", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left", width: Math.min(400, Math.max(200, room)) });
        if (!dead) setState("ready");
      } catch {
        if (!dead) setState("unavailable");
      }
    })();
    return () => {
      dead = true;
    };
  }, [navigate]);

  return (
    <div className="grid gap-2">
      {/* Google draws its button into this box; until then (and if it cannot) the old button is shown. */}
      <div ref={box} data-google-button className={state === "ready" ? "flex min-h-10 justify-center" : "hidden"} />
      {state !== "ready" && fallback}
      {error && (
        <p role="alert" className="text-center font-body text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
