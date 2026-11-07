import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

import { AppProvider } from "@/frontend/components/providers/AppProvider";
import { ThemeProvider } from "@/frontend/components/providers/ThemeProvider";
import { TopBar, BottomNav } from "@/frontend/components/ui/Navigation";
import {
  PushNotification,
  ToastNotification,
} from "@/frontend/components/ui/Notifications";

export const metadata: Metadata = {
  title: "ShiftSafe - Food-delivery income-protection prototype",
  description:
    "Personal no-money prototype with modelled weather, explained historical quotes and sandbox receipts. No active insurance or payouts.",

  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

// Inline script to prevent FOUC (flash of unstyled/wrong-themed content)
const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('shiftsafe-theme') || 'system';
    var d = t === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : t;
    document.documentElement.classList.add(d);
  } catch(e){}
})();
`;

// Guard against browser extensions that patch history APIs and throw
// during Next.js router navigations (seen as pushState dispatchEvent null errors).
const historyGuardScript = `
(function(){
  if (typeof window === 'undefined' || !window.history) return;

  var originalPush = window.history.pushState
    ? window.history.pushState.bind(window.history)
    : null;
  var originalReplace = window.history.replaceState
    ? window.history.replaceState.bind(window.history)
    : null;

  function isDispatchEventNullError(err) {
    var msg = '';
    try {
      msg = err && err.message ? String(err.message) : String(err);
    } catch (_e) {}
    return msg.indexOf('dispatchEvent') !== -1 && msg.indexOf('null') !== -1;
  }

  function asUrlString(url) {
    if (url == null) return '';
    try {
      return String(url);
    } catch (_e) {
      return '';
    }
  }

  if (originalPush) {
    window.history.pushState = function pushStateSafe(state, title, url) {
      try {
        return originalPush(state, title, url);
      } catch (err) {
        if (!isDispatchEventNullError(err)) throw err;
        var target = asUrlString(url);
        if (target) window.location.assign(target);
      }
    };
  }

  if (originalReplace) {
    window.history.replaceState = function replaceStateSafe(state, title, url) {
      try {
        return originalReplace(state, title, url);
      } catch (err) {
        if (!isDispatchEventNullError(err)) throw err;
        var target = asUrlString(url);
        if (target && target !== window.location.href) {
          window.location.replace(target);
        }
      }
    };
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="shiftsafe-theme-init" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <Script id="shiftsafe-history-guard" strategy="beforeInteractive">
          {historyGuardScript}
        </Script>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f97316" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body
        className={`${inter.className} antialiased bg-slate-50 text-slate-800`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <AppProvider>
            <PushNotification />
            <ToastNotification />

            <div className="min-h-screen flex flex-col max-w-120 md:max-w-4xl mx-auto bg-white shadow-2xl overflow-hidden relative">
              <TopBar />

              {/* Scrollable Main Area */}
              <main className="flex-1 overflow-y-auto w-full px-4 pt-4 pb-24 scroll-smooth">
                {children}
              </main>

              <BottomNav />
            </div>
          </AppProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

