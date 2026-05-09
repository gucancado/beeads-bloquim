// MUST be imported before any other module so Sentry can patch globals
// (HTTP, undici, etc.) for auto-instrumentation. No-op without SENTRY_DSN.
import { initSentry } from "./lib/sentry";

initSentry();
