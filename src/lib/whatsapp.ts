import { money, type Product } from "./products";

export const WHATSAPP_NUMBER = "250785762690";

export type OrderDetails = {
  name: string;
  phone: string;
  location: string;
  time: string;
  notes?: string;
};

const origin = () => (typeof window === "undefined" ? "https://moamart.app" : window.location.origin);

export function buildWhatsAppMessage(
  items: { product: Product; qty: number }[],
  details: OrderDetails,
) {
  const total = items.reduce((s, i) => s + i.qty * i.product.price, 0);
  const lines: string[] = [
    "*MOA MART — NEW ORDER*",
    "",
    "*CLIENT INFO*",
    `• Name: ${details.name}`,
    `• Phone: ${details.phone}`,
    `• Delivery location: ${details.location}`,
    `• Preferred order time: ${details.time}`,
  ];
  if (details.notes) lines.push(`• Notes: ${details.notes}`);
  lines.push("", "*PRODUCT INFO*");
  items.forEach((i, idx) => {
    lines.push(
      `${idx + 1}. ${i.product.name}`,
      `   • Price: ${money(i.product.price)} × ${i.qty} = ${money(i.product.price * i.qty)}`,
      `   • Page: ${origin()}/product/${i.product.id}`,
      `   • Image: ${i.product.images[0] ?? ""}`,
    );
  });
  lines.push("", `*TOTAL: ${money(total)}*`, "", "Sent from MOA Mart web app.");
  return lines.join("\n");
}

export function openWhatsApp(message: string) {
  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}