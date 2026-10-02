import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { PRODUCTS, type Product } from "./products";

export type CartItem = { product: Product; qty: number };
export type ChatMessage = { id: string; from: "client" | "staff"; text: string; at: string };

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
  }, [wishlist, toggleWishlist, cart, addToCart, cartOpen, chatOpen, messages]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}