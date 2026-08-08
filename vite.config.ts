import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [vue()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src/ui", import.meta.url))
        }
    },
    server: {
        watch: {
            ignored: [
                "**/src/app/**",
                "**/dist/**",
                "**/release/**",
                "**/build/**",
                "**/tools/unity-worker/.venv/**",
                "**/tools/unity-worker/__pycache__/**",
                "**/tools/unity-worker/test-data/**"
            ]
        }
    },
    base: "./"
});
