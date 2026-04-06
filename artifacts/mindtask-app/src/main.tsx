import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Capture phase — runs before the Replit runtime-error-modal plugin's bubble listeners.
// Suppress the error overlay for any non-Error thrown value (null, undefined, string,
// plain object, etc.) that Tiptap, ReactFlow, or browser internals occasionally emit.
// We still log these to the console so they remain diagnosable.

window.addEventListener("error", (event) => {
  if (!(event.error instanceof Error)) {
    if (
      event.message &&
      event.message !== "Script error." &&
      !event.message.includes("ResizeObserver loop")
    ) {
      console.warn("[mindtask] suppressed non-Error exception:", event.message, event.error);
    }
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}, true);

window.addEventListener("unhandledrejection", (event) => {
  if (!(event.reason instanceof Error)) {
    console.warn("[mindtask] suppressed non-Error rejection:", event.reason);
    event.stopImmediatePropagation();
    event.preventDefault();
  }
}, true);

createRoot(document.getElementById("root")!).render(<App />);
