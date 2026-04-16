"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAppState } from "@/frontend/components/providers/AppProvider";
import { useTheme } from "@/frontend/components/providers/ThemeProvider";

export function BottomNav() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/register" || pathname === "/login") {
    return null;
  }

  const links = [
    { href: "/dashboard", icon: "📊", label: "Home" },
    { href: "/monitoring", icon: "🗺️", label: "Live" },
    { href: "/policies", icon: "🛡️", label: "Policy" },
    { href: "/claims", icon: "⚡", label: "Claims" },
    { href: "/service-requests", icon: "📝", label: "Support" },
    { href: "/actuarial", icon: "🧮", label: "Actuarial" },
    { href: "/analytics", icon: "📈", label: "Analytics" },
  ];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-xl border-t border-slate-200/60 pb-[env(safe-area-inset-bottom,16px)]">
      <div className="max-w-120 mx-auto flex items-center justify-around px-2 py-3">
        {links.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-col items-center gap-1 transition-all min-w-14 min-h-11 justify-center ${
                active
                  ? "text-primary-500 scale-105"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <span
                className={`text-xl ${active ? "" : "opacity-70 grayscale"}`}
              >
                {l.icon}
              </span>
              <span
                className={`text-[10px] font-bold tracking-wider uppercase ${active ? "text-primary-500" : "text-gray-500"}`}
              >
                {l.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { worker, policy, signOut } = useAppState();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const themeDropdownRef = useRef<HTMLDivElement>(null);

  // all hooks must run before any early return (React rules of hooks)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
      if (
        themeDropdownRef.current &&
        !themeDropdownRef.current.contains(e.target as Node)
      ) {
        setThemeOpen(false);
      }
    };
    if (profileOpen || themeOpen)
      document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileOpen, themeOpen]);

  // hide on splash / register
  if (pathname === "/" || pathname === "/register" || pathname === "/login") {
    return null;
  }

  const initials = worker?.name
    ? worker.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  const handleSignOut = async () => {
    setProfileOpen(false);
    await signOut();
    router.push("/");
  };

  const themeOptions: {
    value: "light" | "dark" | "system";
    label: string;
    icon: string;
    desc: string;
  }[] = [
    { value: "light", label: "Light", icon: "☀️", desc: "Always light" },
    { value: "dark", label: "Dark", icon: "🌙", desc: "Always dark" },
    { value: "system", label: "System", icon: "💻", desc: "Match device" },
  ];

  const currentThemeIcon =
    resolvedTheme === "dark" ? "🌙" : theme === "system" ? "💻" : "☀️";

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-slate-200/60 transition-all duration-300">
      <div className="max-w-120 mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shadow-md bg-linear-to-br from-primary-500 to-primary-700 text-white">
            🛡️
          </div>
          <span className="text-xl font-extrabold text-slate-800 tracking-tight">
            ShiftSafe<span className="text-primary-500 font-medium">DT</span>
          </span>
        </Link>

        <div className="flex items-center gap-2.5">
          <div className="hidden sm:flex sm:items-center sm:gap-2 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-500/20 shadow-sm">
            <span className="live-dot" />
            <span className="text-[10px] text-emerald-600 font-extrabold tracking-widest uppercase">
              Live
            </span>
          </div>

          {/* Theme Toggle */}
          <div className="relative" ref={themeDropdownRef}>
            <button
              onClick={() => {
                setThemeOpen(!themeOpen);
                setProfileOpen(false);
              }}
              className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-lg shadow-sm border border-slate-200 transition-all hover:scale-105 active:scale-95"
              aria-label="Toggle theme"
            >
              {currentThemeIcon}
            </button>

            {themeOpen && (
              <div className="absolute right-0 top-12 w-52 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden fade-in z-50">
                <div className="px-3 py-2.5 border-b border-slate-100">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    Appearance
                  </div>
                </div>
                <div className="p-1.5">
                  {themeOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setTheme(opt.value);
                        setThemeOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                        theme === opt.value
                          ? "bg-primary-50 border border-primary-200"
                          : "hover:bg-slate-50 border border-transparent"
                      }`}
                    >
                      <span className="text-lg">{opt.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div
                          className={`text-xs font-bold ${theme === opt.value ? "text-primary-600" : "text-slate-700"}`}
                        >
                          {opt.label}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {opt.desc}
                        </div>
                      </div>
                      {theme === opt.value && (
                        <span className="text-primary-500 text-sm font-bold">
                          ✓
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Link
            href="/admin"
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-lg shadow-sm border border-slate-200 transition-all hover:scale-105 active:scale-95"
            aria-label="Admin Dashboard"
          >
            ⚙️
          </Link>

          {/* Profile Avatar */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => {
                setProfileOpen(!profileOpen);
                setThemeOpen(false);
              }}
              className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-md transition-all hover:scale-105 active:scale-95"
              style={{
                background: "linear-gradient(135deg, #f97316, #ea580c)",
              }}
              aria-label="Profile menu"
            >
              {initials}
            </button>

            {/* Dropdown */}
            {profileOpen && (
              <div className="absolute right-0 top-12 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden fade-in z-50">
                {/* Header */}
                <div
                  className="px-4 pt-4 pb-3 border-b border-slate-100"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(249,115,22,0.06), rgba(234,88,12,0.03))",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-md shrink-0"
                      style={{
                        background: "linear-gradient(135deg, #f97316, #ea580c)",
                      }}
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 truncate">
                        {worker?.name || "Worker"}
                      </div>
                      <div className="text-[11px] text-gray-500">
                        +91-{worker?.phone || "—"}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="px-4 py-3 space-y-2.5">
                  {[
                    {
                      icon: "📱",
                      label: "Platform",
                      value: worker?.platform || "—",
                    },
                    { icon: "📍", label: "Zone", value: worker?.zone || "—" },
                    {
                      icon: "💰",
                      label: "Weekly Earnings",
                      value: `₹${worker?.avgWeeklyEarnings?.toLocaleString() || "—"}`,
                    },
                    {
                      icon: "🕐",
                      label: "Hours/Day",
                      value: `${worker?.hoursPerDay || "—"} hrs`,
                    },
                    {
                      icon: "💳",
                      label: "UPI ID",
                      value: worker?.upiId || "—",
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between"
                    >
                      <span className="text-[11px] text-gray-500 flex items-center gap-1.5">
                        <span>{item.icon}</span> {item.label}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-800">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Policy status bar */}
                <div className="px-4 py-2.5 bg-emerald-50/50 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    Policy Active
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    {policy?.id ? policy.id.slice(0, 11) : "POL-001"}
                  </span>
                </div>

                {/* Sign Out */}
                <button
                  onClick={handleSignOut}
                  className="w-full px-4 py-3 text-left text-[12px] font-bold text-red-500 hover:bg-red-50 border-t border-slate-100 transition-colors flex items-center gap-2"
                >
                  <span>🚪</span> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

