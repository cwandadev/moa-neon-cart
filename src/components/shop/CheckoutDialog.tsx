import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money, type Product } from "@/lib/products";
import { buildWhatsAppMessage, openWhatsApp } from "@/lib/whatsapp";

export function CheckoutDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: { product: Product; qty: number }[];
}) {
  const [form, setForm] = useState({ name: "", phone: "", location: "", time: "As soon as possible", notes: "" });
  const total = items.reduce((s, i) => s + i.qty * i.product.price, 0);
  const valid = form.name.trim() && form.phone.trim() && form.location.trim();

  const submit = () => {
    openWhatsApp(buildWhatsAppMessage(items, form));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Order via WhatsApp</DialogTitle>
          <DialogDescription className="font-body">
            We format your order into a clean WhatsApp message and send it straight to our sales desk.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="co-name">Full name</Label>
            <Input id="co-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Alice Uwase" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="co-phone">Phone number</Label>
              <Input id="co-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+250 78..." />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="co-time">Preferred order time</Label>
              <Input id="co-time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="co-loc">Delivery location</Label>
            <Input id="co-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Kigali, Kimihurura — KG 7 Ave" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="co-notes">Notes (optional)</Label>
            <Textarea id="co-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>

          <div className="rounded-xl border border-border bg-muted/40 p-3 font-body text-sm">
            {items.map((i) => (
              <div key={i.product.id} className="flex justify-between gap-3 py-0.5">
                <span className="min-w-0 truncate text-muted-foreground">
                  {i.product.name} × {i.qty}
                </span>
                <span className="shrink-0">{money(i.product.price * i.qty)}</span>
              </div>
            ))}
            <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
              <span>Total</span>
              <span className="text-primary">{money(total)}</span>
            </div>
          </div>

          <Button variant="neon" size="lg" disabled={!valid} onClick={submit}>
            <i className="bx bxl-whatsapp text-xl" /> Send order on WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}