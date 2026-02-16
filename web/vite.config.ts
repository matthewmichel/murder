import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: Number(process.env.MURDER_UI_PORT ?? 1314),
  },
  plugins: [tailwindcss(), reactRouter()],
});
