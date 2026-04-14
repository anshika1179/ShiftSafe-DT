"use client";
import { useState, useEffect, useCallback } from "react";

interface NotificationData {
  emoji: string;
  title: string;
  subtitle: string;
  value: string;
  amount: number;
}

let showNotificationFn: ((data: NotificationData) => void) | null = null;

export function triggerNotification(data: NotificationData) {
  if (showNotificationFn) showNotificationFn(data);
}

export function PushNotification() {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<NotificationData | null>(null);

  const show = useCallback((d: NotificationData) => {
    setData(d);
    setVisible(true);
    setTimeout(() => setVisible(false), 6000);
  }, []);

  useEffect(() => {
    showNotificationFn = show;
    return () => {
      showNotificationFn = null;
    };
  }, [show]);

  if (!data) return null;

  return (
    <div
      className="fixed z-9999 transition-all duration-500"
      style={{
        top: "16px",
        left: "50%",
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(-120px)",
        width: "min(92%, 28rem)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div className="glass-card p-4 border-l-4 border-l-emerald-500 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0 mt-0.5">{data.emoji}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold text-primary-500 uppercase tracking-widest">
                ShiftSafe Alert
              </span>
              <span className="text-[10px] text-gray-500">Just now</span>
            </div>
            <p className="text-sm font-bold text-slate-900 mb-1">
              {data.title}
            </p>
            <p className="text-xs text-gray-600 mb-2">{data.subtitle}</p>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <span className="text-xs text-gray-500">
                {data.value || "Claim screening in progress"}
              </span>
              <span className="text-sm font-bold text-emerald-500">
                ₹{data.amount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Toast ───
interface ToastData {
  message: string;
  type: "success" | "error";
}

let showToastFn: ((data: ToastData) => void) | null = null;

export function triggerToast(
  message: string,
  type: "success" | "error" = "success",
) {
  if (showToastFn) showToastFn({ message, type });
}

export function ToastNotification() {
  const [visible, setVisible] = useState(false);
  const [data, setData] = useState<ToastData | null>(null);

  const show = useCallback((d: ToastData) => {
    setData(d);
    setVisible(true);
    setTimeout(() => setVisible(false), 3500);
  }, []);

  useEffect(() => {
    showToastFn = show;
    return () => {
      showToastFn = null;
    };
  }, [show]);

  if (!data) return null;

  const isSuccess = data.type === "success";

  return (
    <div
      className="fixed z-9998 transition-all duration-400"
      style={{
        bottom: "5rem",
        left: "50%",
        transform: visible
          ? "translateX(-50%) translateY(0)"
          : "translateX(-50%) translateY(20px)",
        width: "min(85%, 24rem)",
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        className="px-4 py-3 rounded-xl text-sm font-semibold text-center shadow-lg"
        style={{
          background: isSuccess
            ? "rgba(16, 185, 129, 0.1)"
            : "rgba(239, 68, 68, 0.1)",
          border: `1px solid ${isSuccess ? "rgba(16, 185, 129, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
          color: isSuccess ? "#34d399" : "#f87171",
        }}
      >
        {isSuccess ? "✓ " : "✗ "}
        {data.message}
      </div>
    </div>
  );
}
