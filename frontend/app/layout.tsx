import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { AppProvider } from "@/frontend/components/providers/AppProvider";
import { ThemeProvider } from "@/frontend/components/providers/ThemeProvider";
import { TopBar, BottomNav } from "@/frontend/components/ui/Navigation";
import {
  PushNotification,
  ToastNotification,
} from "@/frontend/components/ui/Notifications";

export const metadata: Metadata = {
  title: "ShiftSafe DT — AI Income Protection for Delivery Partners",
  description:
    "Parametric micro-insurance for India's gig economy workers. Real-time weather triggers, automatic payouts, zero paperwork.",

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#f97316" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="mobile-web-app-capable" content="yes" />
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

            <div className="min-h-screen flex flex-col max-w-120 mx-auto bg-white shadow-2xl overflow-hidden relative">
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

