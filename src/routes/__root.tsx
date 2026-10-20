import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { StoreProvider } from "../lib/store";
import { Toaster } from "../components/ui/sonner";
import { NotificationsHost } from "../lib/notifications";
import { AuthProvider } from "../lib/auth";
import { CartDrawer } from "../components/shop/CartDrawer";
import { SupportChat } from "../components/shop/SupportChat";
import { BottomNav } from "../components/shop/BottomNav";
import { SiteFooter } from "../components/shop/SiteFooter";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

/** Pages for customers only: search engines should not list them. */
const PRIVATE_ROUTES = [
  "/admin",
  "/account",
  "/orders",
  "/notifications",
  "/wishlist",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];
const privateMeta = (matches: { routeId?: unknown }[]) => {
  const id = String(matches[matches.length - 1]?.routeId ?? "");
  return PRIVATE_ROUTES.some((p) => id === p || id.startsWith(`${p}/`) || id.startsWith(`${p}.`))
    ? [{ name: "robots", content: "noindex, nofollow" }]
    : [];
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ matches }) => ({
    meta: [
      ...privateMeta(matches),
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MOA Mart" },
      { name: "description", content: "Shop clothing, shoes, kitchen items, electronics and more at MOA Mart." },
      { name: "author", content: "MOA Mart" },
      { property: "og:title", content: "MOA Mart" },
      { property: "og:description", content: "Shop clothing, shoes, kitchen items, electronics and more at MOA Mart." },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "MOA Mart" },
      { property: "og:locale", content: "en_RW" },
      { name: "twitter:card", content: "summary_large_image" },
      
      { name: "theme-color", content: "#0a0d13" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&family=Jost:wght@300;400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: "https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css",
      },
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml", sizes: "any" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
      <StoreProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <SiteFooter />
        <CartDrawer />
        <SupportChat />
        <BottomNav />
      <Toaster position="top-center" />
      <NotificationsHost />
      </StoreProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
