import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PRODUCTS, type Product } from "./products";

export type CartItem = { product: Product; qty: number };
export type ChatMessage = { id: string; from: "client" | "staff"; text: string; at: string };

export type AdminProduct = Product & { sku: string; cost: number };

export type OrderStatus =
  | "Pending Confirmation"
  | "Payment Verified"
  | "Out for Delivery"
  | "Fulfilled"
  | "Cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "Pending Confirmation",
  "Payment Verified",
  "Out for Delivery",
  "Fulfilled",
  "Cancelled",
];

export type WhatsAppOrder = {
  id: string;
  customer: string;
  phone: string;
  location: string;
  orderType: string;
  time: string;
  items: { name: string; price: number; image: string; qty: number }[];
  total: number;
  status: OrderStatus;
  createdAt: string;
};

export type AdminMessage = { id: string; from: "client" | "staff"; body: string; at: string };
export type AdminThread = {
  id: string;
  name: string;
  status: "online" | "away";
  messages: AdminMessage[];
};

const adminNow = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const P = (i: number) => PRODUCTS[i]!;

const seedOrders: WhatsAppOrder[] = [
  {
    id: "WA-4821",
    customer: "Jean Bosco",
    phone: "+250788112233",
    location: "Kigali, Kimihurura",
    orderType: "Express Delivery",
    time: "Today 14:00",
    items: [{ name: P(5).name, price: P(5).price, image: P(5).images[0]!, qty: 1 }],
    total: P(5).price,
    status: "Pending Confirmation",
    createdAt: "2026-08-12 09:14",
  },
  {
    id: "WA-4818",
    customer: "Sandrine K.",
    phone: "+250722889001",
    location: "Musanze Centre",
    orderType: "Standard Delivery",
    time: "Tomorrow 10:00",
    items: [{ name: P(20).name, price: P(20).price, image: P(20).images[0]!, qty: 2 }],
    total: P(20).price * 2,
    status: "Payment Verified",
    createdAt: "2026-08-11 17:42",
  },
  {
    id: "WA-4809",
    customer: "Eric N.",
    phone: "+250733554477",
    location: "Kigali, Nyarutarama",
    orderType: "Store Pickup",
    time: "Today 18:30",
    items: [{ name: P(11).name, price: P(11).price, image: P(11).images[0]!, qty: 1 }],
    total: P(11).price,
    status: "Out for Delivery",
    createdAt: "2026-08-11 08:05",
  },
  {
    id: "WA-4790",
    customer: "Peace M.",
    phone: "+250788990011",
    location: "Huye",
    orderType: "Express Delivery",
    time: "Yesterday 12:00",
    items: [{ name: P(14).name, price: P(14).price, image: P(14).images[0]!, qty: 1 }],
    total: P(14).price,
    status: "Fulfilled",
    createdAt: "2026-08-10 15:20",
  },
];

const seedThreads: AdminThread[] = [
  {
    id: "t1",
    name: "Jean Bosco",
    status: "online",
    messages: [
      { id: "m1", from: "client", body: "Hi, is the Vector Runner V3 available in size 44?", at: "09:12" },
      { id: "m2", from: "staff", body: "Yes, 44 is in stock. Want me to reserve a pair?", at: "09:13" },
      { id: "m3", from: "client", body: "Please do. I will order via WhatsApp now.", at: "09:14" },
    ],
  },
  {
    id: "t2",
    name: "Sandrine K.",
    status: "online",
    messages: [
      { id: "m1", from: "client", body: "Do the Flux earbuds support LDAC?", at: "17:40" },
      { id: "m2", from: "staff", body: "They do — LDAC and AAC, with adaptive ANC.", at: "17:41" },
    ],
  },
  {
    id: "t3",
    name: "Eric N.",
    status: "away",
    messages: [
      { id: "m1", from: "client", body: "Any delivery to Nyarutarama today?", at: "08:02" },
    ],
  },
];

type StoreValue = {
  wishlist: string[];
  toggleWishlist: (id: string) => void;
  isWished: (id: string) => boolean;
  cart: CartItem[];
  addToCart: (product: Product, qty?: number) => void;
  removeFromCart: (id: string) => void;
  setQty: (id: string, qty: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  messages: ChatMessage[];
  sendMessage: (text: string, from?: "client" | "staff") => void;
  products: AdminProduct[];
  orders: WhatsAppOrder[];
  threads: AdminThread[];
  toggleStock: (id: string) => void;
  updateStock: (id: string, stock: number) => void;
  addOrder: (o: Omit<WhatsAppOrder, "id" | "status" | "createdAt">) => void;
  setOrderStatus: (id: string, s: OrderStatus) => void;
  sendStaffMessage: (threadId: string, body: string) => void;
};

const StoreContext = createContext<StoreValue | null>(null);

const now = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

export function StoreProvider({ children }: { children: ReactNode }) {
  const [wishlist, setWishlist] = useState<string[]>([
    PRODUCTS[0]?.id ?? "",
    PRODUCTS[8]?.id ?? "",
  ]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [products, setProducts] = useState<AdminProduct[]>(() =>
    PRODUCTS.map((p, i) => ({
      ...p,
      sku: `MOA-${p.category.slice(0, 2).toUpperCase()}-${1000 + i}`,
      cost: Math.round(p.price * 0.58),
    })),
  );
  const [orders, setOrders] = useState<WhatsAppOrder[]>(seedOrders);
  const [threads, setThreads] = useState<AdminThread[]>(seedThreads);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "m1", from: "staff", text: "Hi 👋 Welcome to MOA Mart. How can we help you today?", at: "09:12" },
  ]);

  const toggleWishlist = useCallback((id: string) => {
    setWishlist((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const addToCart = useCallback((product: Product, qty = 1) => {
    setCart((prev) => {
      const found = prev.find((i) => i.product.id === product.id);
      if (found) return prev.map((i) => (i.product.id === product.id ? { ...i, qty: i.qty + qty } : i));
      return [...prev, { product, qty }];
    });
  }, []);

  const toggleStock = useCallback((id: string) => {
    setProducts((ps) =>
      ps.map((p) =>
        p.id === id ? { ...p, stock: p.stock > 0 ? 0 : 12, inStock: p.stock <= 0 } : p,
      ),
    );
  }, []);

  const updateStock = useCallback((id: string, stock: number) => {
    setProducts((ps) =>
      ps.map((p) =>
        p.id === id ? { ...p, stock: Math.max(0, stock), inStock: Math.max(0, stock) > 0 } : p,
      ),
    );
  }, []);

  const addOrder = useCallback((o: Omit<WhatsAppOrder, "id" | "status" | "createdAt">) => {
    setOrders((prev) => [
      {
        ...o,
        id: `WA-${Math.floor(4830 + Math.random() * 160)}`,
        status: "Pending Confirmation",
        createdAt: new Date().toISOString().slice(0, 16).replace("T", " "),
      },
      ...prev,
    ]);
  }, []);

  const setOrderStatus = useCallback((id: string, s: OrderStatus) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: s } : o)));
  }, []);

  const sendStaffMessage = useCallback((threadId: string, body: string) => {
    setThreads((ts) =>
      ts.map((t) =>
        t.id === threadId
          ? {
              ...t,
              messages: [
                ...t.messages,
                { id: `m${t.messages.length + 1}`, from: "staff" as const, body, at: adminNow() },
              ],
            }
          : t,
      ),
    );
    setTimeout(() => {
      setThreads((ts) =>
        ts.map((t) =>
          t.id === threadId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  {
                    id: `m${t.messages.length + 2}`,
                    from: "client" as const,
                    body: "Perfect, thank you! I'll confirm on WhatsApp.",
                    at: adminNow(),
                  },
                ],
              }
            : t,
        ),
      );
    }, 1600);
  }, []);

  const value = useMemo<StoreValue>(() => {
    const cartCount = cart.reduce((s, i) => s + i.qty, 0);
    return {
      wishlist,
      toggleWishlist,
      isWished: (id) => wishlist.includes(id),
      cart,
      addToCart,
      removeFromCart: (id) => setCart((prev) => prev.filter((i) => i.product.id !== id)),
      setQty: (id, qty) =>
        setCart((prev) =>
          prev.flatMap((i) =>
            i.product.id === id ? (qty <= 0 ? [] : [{ ...i, qty }]) : [i],
          ),
        ),
      clearCart: () => setCart([]),
      cartCount,
      cartTotal: cart.reduce((s, i) => s + i.qty * i.product.price, 0),
      cartOpen,
      setCartOpen,
      chatOpen,
      setChatOpen,
      products,
      orders,
      threads,
      toggleStock,
      updateStock,
      addOrder,
      setOrderStatus,
      sendStaffMessage,
      messages,
      sendMessage: (text, from = "client") =>
        setMessages((prev) => [
          ...prev,
          { id: `m${prev.length + 1}`, from, text, at: now() },
          ...(from === "client"
            ? [
                {
                  id: `m${prev.length + 2}`,
                  from: "staff" as const,
                  text: "Thanks for reaching out! A MOA Mart agent is picking this up now.",
                  at: now(),
                },
              ]
            : []),
        ]),
    };
  }, [wishlist, toggleWishlist, cart, addToCart, cartOpen, chatOpen, messages, products, orders, threads, toggleStock, updateStock, addOrder, setOrderStatus, sendStaffMessage]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}