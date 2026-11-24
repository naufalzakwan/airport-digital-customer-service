import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const certFile = path.resolve(__dirname, "certs/echo-call.pem");
  const keyFile = path.resolve(__dirname, "certs/echo-call-key.pem");
  const useHttps = command === "serve" && mode === "https";
  if (useHttps && (!fs.existsSync(certFile) || !fs.existsSync(keyFile))) {
    throw new Error("Sertifikat HTTPS belum tersedia. Ikuti HTTPS_LOKAL.md untuk membuatnya dengan mkcert.");
  }
  return {
  // HTTP and HTTPS dev servers can run together without replacing each other's optimized dependencies.
  cacheDir: mode === "https" ? "node_modules/.vite-https" : "node_modules/.vite",
  server: {
    host: useHttps ? "0.0.0.0" : "127.0.0.1",
    port: 5173,
    strictPort: true,
    https: useHttps ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) } : undefined,
    proxy: {
      "/socket.io": {
        target: "http://127.0.0.1:3000",
        ws: true,
        configure(proxy) {
          const markTransport = (upstream: import('node:http').ClientRequest, request: import('node:http').IncomingMessage) => {
            const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress || '');
            upstream.setHeader('x-airport-proxy-protocol', useHttps ? 'https' : 'http');
            upstream.setHeader('x-airport-loopback-client', local ? 'yes' : 'no');
          };
          proxy.on('proxyReq', markTransport);
          proxy.on('proxyReqWs', markTransport);
        },
      },
    },
    fs: {
      deny: [
        ".env", ".env.*", "*.{crt,cer,pem,key,p12,pfx}", "**/.git/**",
        "**/certs/**", "**/server/cert/**", "**/server/data/**",
        `${normalizePath(path.resolve(__dirname, ".local-archive"))}/**`,
        `${normalizePath(path.resolve(__dirname, ".release-check"))}/**`,
        ".npmrc",
        "*.{sqlite,sqlite3,db}{,-wal,-shm,-journal}", "*.log",
      ],
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  };
});
