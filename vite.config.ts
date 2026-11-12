import { defineConfig } from "vitest/config";

export default defineConfig({
    base: "./",
    build: { target: "es2022", chunkSizeWarningLimit: 1024 },
    test: { include: ["test/**/*.test.ts"], testTimeout: 120_000, reporters: ["verbose"] },
});
