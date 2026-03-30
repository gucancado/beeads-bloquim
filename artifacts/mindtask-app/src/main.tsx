import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

window.addEventListener("unhandledrejection", (event) => {
  if (!(event.reason instanceof Error)) {
    console.error("[mindtask] unhandled non-Error rejection:", JSON.stringify(event.reason), typeof event.reason);
  }
});

window.addEventListener("error", (event) => {
  if (event.error !== null && event.error !== undefined && !(event.error instanceof Error)) {
    console.error("[mindtask] uncaught non-Error exception:", JSON.stringify(event.error), typeof event.error);
  }
});

createRoot(document.getElementById("root")!).render(<App />);
