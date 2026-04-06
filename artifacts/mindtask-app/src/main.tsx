import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Capture-phase handlers that intercept all unhandled errors and unhandled promise
// rejections before they reach the Replit proxy-page monitoring system.
//
// Background: the Replit workspace wraps the app in a same-origin iframe and monitors
// errors via window.onerror on the proxy page. The proxy page checks
// `error instanceof Error` using *its own frame's* Error constructor, so even proper
// Error objects thrown inside our iframe fail the cross-frame instanceof check and get
// labelled "(unknown runtime error)" — causing spurious "crashed" notifications.
//
// React's ErrorBoundary already handles all render-time errors (showing the
// "algo deu errado." UI), so suppressing window-level error events here does NOT hide
// real user-facing breakage. Non-render errors (DOM handlers, async callbacks) are
// logged to the console below for debugging, and then suppressed so they don't
// trigger the proxy-page crash indicator.

window.addEventListener("error", (event) => {
  const msg = event.message ?? "";
  if (msg === "Script error." || msg.includes("ResizeObserver loop")) {
    return;
  }
  console.error("[mindtask] unhandled error:", event.error ?? msg);
  event.stopImmediatePropagation();
  event.preventDefault();
}, true);

window.addEventListener("unhandledrejection", (event) => {
  console.error("[mindtask] unhandled rejection:", event.reason);
  event.stopImmediatePropagation();
  event.preventDefault();
}, true);

createRoot(document.getElementById("root")!).render(<App />);
