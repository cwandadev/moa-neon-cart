import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

type Msg = { kind: "ok" | "err"; text: string } | null;

const card = "rounded-2xl border border-border bg-card/60 p-5";
const heading = "font-display text-sm font-medium tracking-tight";

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`mt-3 font-body text-sm ${msg.kind === "ok" ? "text-accent" : "text-destructive"}`}>
      {msg.text}
    </p>
  );
}

export function AccountSettings() {
  const { user, refreshProfile } = useAuth();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState<"" | "profile" | "delivery" | "devices">("");
  const [pMsg, setPMsg] = useState<Msg>(null);
  const [dMsg, setDMsg] = useState<Msg>(null);
  const [sMsg, setSMsg] = useState<Msg>(null);

  useEffect(() => {
    if (!user) return;
    setFirst(user.firstName);
    setLast(user.lastName);
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("phone, default_location")
          .eq("id", user.id)
          .maybeSingle();
        if (cancelled || !data) return;
        setPhone((data.phone as string | null) ?? "");
        setLocation((data.default_location as string | null) ?? "");
      } catch {
        /* leave the fields empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.firstName, user?.lastName]);

  if (!user) return null;

  const saveProfile = async () => {
    const f = first.trim();
    const l = last.trim();
    const p = phone.trim();
    if (!f || !l) {
      setPMsg({ kind: "err", text: "Please enter your first and last name." });
      return;
    }
    if (p && !/^[+0-9 ()-]{7,20}$/.test(p)) {
      setPMsg({ kind: "err", text: "Enter a valid phone number." });
      return;
    }
    setBusy("profile");
    setPMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({ first_name: f, last_name: l, phone: p || null })
      .eq("id", user.id);
    setBusy("");
    if (error) setPMsg({ kind: "err", text: error.message });
    else {
      setPMsg({ kind: "ok", text: "Profile saved." });
      refreshProfile();
    }
  };

  const saveDelivery = async () => {
    setBusy("delivery");
    setDMsg(null);
    const { error } = await supabase
      .from("profiles")
      .update({ default_location: location.trim() || null })
      .eq("id", user.id);
    setBusy("");
    if (error) setDMsg({ kind: "err", text: error.message });
    else setDMsg({ kind: "ok", text: "Delivery details saved." });
  };

  const signOutOthers = async () => {
    setBusy("devices");
    setSMsg(null);
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setBusy("");
    if (error) setSMsg({ kind: "err", text: error.message });
    else setSMsg({ kind: "ok", text: "Signed out of all your other devices." });
  };

  return (
    <>
      <section className={card}>
        <h2 className={heading}>Profile</h2>
        <p className="mt-1 font-body text-xs text-muted-foreground">
          Your email is {user.email}. It is your login and cannot be changed here.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="as-first" className="font-body text-sm">First name</Label>
            <Input id="as-first" value={first} onChange={(e) => setFirst(e.target.value)} className="h-10 rounded-xl" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="as-last" className="font-body text-sm">Last name</Label>
            <Input id="as-last" value={last} onChange={(e) => setLast(e.target.value)} className="h-10 rounded-xl" />
          </div>
        </div>
        <div className="mt-3 grid gap-1.5">
          <Label htmlFor="as-phone" className="font-body text-sm">Phone number</Label>
          <Input id="as-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+250 78..." className="h-10 rounded-xl" />
        </div>
        <Button className="mt-4 h-10 rounded-xl font-body" disabled={busy === "profile"} onClick={() => void saveProfile()}>
          {busy === "profile" ? "Saving…" : "Save profile"}
        </Button>
        <Note msg={pMsg} />
      </section>

      <section className={card}>
        <h2 className={heading}>Delivery details</h2>
        <p className="mt-1 font-body text-xs text-muted-foreground">
          Your phone number and this address are filled in for you at checkout.
        </p>
        <div className="mt-4 grid gap-1.5">
          <Label htmlFor="as-loc" className="font-body text-sm">Delivery location</Label>
          <Input id="as-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Kigali, Kimihurura — KG 7 Ave" className="h-10 rounded-xl" />
        </div>
        <Button className="mt-4 h-10 rounded-xl font-body" disabled={busy === "delivery"} onClick={() => void saveDelivery()}>
          {busy === "delivery" ? "Saving…" : "Save delivery details"}
        </Button>
        <Note msg={dMsg} />
      </section>

      <section className={card}>
        <h2 className={heading}>Security</h2>
        <p className="mt-1 font-body text-xs text-muted-foreground">
          Lost a phone or used a shared computer? Sign out everywhere except this device.
        </p>
        <Button variant="glass" className="mt-4 h-10 rounded-xl font-body" disabled={busy === "devices"} onClick={() => void signOutOthers()}>
          {busy === "devices" ? "Working…" : "Sign out of other devices"}
        </Button>
        <Note msg={sMsg} />
      </section>
    </>
  );
}
