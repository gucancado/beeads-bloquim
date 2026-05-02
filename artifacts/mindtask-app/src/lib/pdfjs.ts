// Use the LEGACY build of pdfjs-dist. The default modern build assumes very
// recent JS proposals (e.g. `Map.prototype.getOrInsertComputed`) that are
// not yet available in production browsers, which causes a runtime
// `TypeError: ... getOrInsertComputed is not a function` when rendering
// pages. The legacy build ships the necessary polyfills.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker file is copied into `src/assets` so Vite serves it through
// its normal asset pipeline at a URL under the artifact's base path
// instead of a `/@fs/...` URL that the SPA fallback can incorrectly
// capture when the dev server runs under a non-root base.
import workerUrl from "@/assets/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjsLib };
