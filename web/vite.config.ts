import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * A Content-Security-Policy for the built site. The app stores API keys in the
 * browser, so the page is locked down: only its own scripts may run, nothing
 * may be embedded or submitted, and it may not be framed. Network requests are
 * limited to HTTPS and to this computer (for local model servers); they cannot
 * be limited further because any model provider address can be configured.
 *
 * It is added at build time only: the dev server needs inline scripts.
 */
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the optional on-device model run its WebAssembly; it does not allow eval of scripts.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "callback-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works at any URL (including GitHub Pages).
  base: "./",
  plugins: [react(), contentSecurityPolicy()],
  // The coaching logic in ../src is shared with the CLI.
  server: { fs: { allow: [".."] } },
});
