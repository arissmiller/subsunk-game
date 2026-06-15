import { defineConfig } from "vite";

const allowedHosts = ["arissmiller.net", "subsunk.arissmiller.net"];

export default defineConfig({
  server: {
    allowedHosts,
  },
  preview: {
    allowedHosts,
  },
});
