"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <html>
      <body
        style={{
          background: "#0f172a",
          color: "#e2e8f0",
          fontFamily: "system-ui",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div
          style={{ textAlign: "center", maxWidth: "400px", padding: "20px" }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2
            style={{
              fontSize: "24px",
              fontWeight: "bold",
              marginBottom: "8px",
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "24px" }}
          >
            ShiftSafe encountered an unexpected error. Your data is safe.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#f97316",
              color: "white",
              border: "none",
              padding: "12px 24px",
              borderRadius: "12px",
              fontSize: "14px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
