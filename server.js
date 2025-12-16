// Dev server imports
import { createBareServer } from "@nebula-services/bare-server-node";
import { createServer } from "http";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import rspackConfig from "./rspack.config.js";
import { rspack } from "@rspack/core";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

// transports
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { bareModulePath } from "@mercuryworkshop/bare-as-module3";
import { chmodSync, mkdirSync, writeFileSync } from "fs";

/*
  NOTES:
  - Put your dark space themed frontend files in ./static (for simple single-page),
    or build into ./dist if you use a frontend build step (rspack).
  - Ensure package.json has: "type": "module" and scripts for "start" and "build".
*/

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const bare = createBareServer("/bare/", {
    logErrors: true,
    blockLocal: false,
});

// Allow proxying loopback/private IPs - be careful in production.
wisp.options.allow_loopback_ips = true;
wisp.options.allow_private_ips = true;

const fastify = Fastify({
    logger: true,
    serverFactory: (handler) => {
        return createServer()
            .on("request", (req, res) => {
                // Required for cross-origin isolation if front-end needs powerful features
                res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

                if (bare.shouldRoute(req)) {
                    bare.routeRequest(req, res);
                } else {
                    handler(req, res);
                }
            })
            .on("upgrade", (req, socket, head) => {
                // WebSocket / upgrade routing
                if (bare.shouldRoute(req)) {
                    bare.routeUpgrade(req, socket, head);
                } else {
                    wisp.routeRequest(req, socket, head);
                }
            });
    },
});

// Static file serving for UI and assets
fastify.register(fastifyStatic, {
    root: join(__dirname, "./static"),
    decorateReply: false,
});

fastify.register(fastifyStatic, {
    root: join(__dirname, "./dist"),
    prefix: "/scram/",
    decorateReply: false,
});

fastify.register(fastifyStatic, {
    root: join(__dirname, "./assets"),
    prefix: "/assets/",
    decorateReply: false,
});

// Serve transport modules (these are provided by their packages)
fastify.register(fastifyStatic, {
    root: baremuxPath,
    prefix: "/baremux/",
    decorateReply: false,
});
fastify.register(fastifyStatic, {
    root: epoxyPath,
    prefix: "/epoxy/",
    decorateReply: false,
});
fastify.register(fastifyStatic, {
    root: libcurlPath,
    prefix: "/libcurl/",
    decorateReply: false,
});
fastify.register(fastifyStatic, {
    root: bareModulePath,
    prefix: "/baremod/",
    decorateReply: false,
});

// Port handling
const PORT = process.env.PORT ? parseInt(process.env.PORT) || 1337 : 1337;

fastify.setNotFoundHandler((request, reply) => {
    fastify.log.error("PAGE PUNCHED THROUGH SW - " + request.url);
    reply.code(593).send("punch through");
});

async function start() {
    try {
        await fastify.listen({
            port: PORT,
            host: "0.0.0.0",
        });
        console.log(`Listening on http://localhost:${PORT}/`);
    } catch (err) {
        console.error("Failed to start server:", err);
        process.exit(1);
    }
}

// Optional: write a git pre-commit hook to run formatting (best-effort)
if (!process.env.CI) {
    try {
        // ensure .git/hooks exists
        try {
            mkdirSync(".git/hooks", { recursive: true });
        } catch (e) {}

        writeFileSync(
            ".git/hooks/pre-commit",
            "pnpm format\ngit update-index --again\n",
            { mode: 0o755 }
        );
        chmodSync(".git/hooks/pre-commit", 0o755);
    } catch (e) {
        // ignore
    }
}

// Optional: run rspack in watch mode during development (only when not in CI)
if (!process.env.CI) {
    try {
        const compiler = rspack(rspackConfig);
        compiler.watch({}, (err, stats) => {
            console.log(
                stats
                    ? stats.toString({
                            preset: "minimal",
                            colors: true,
                            version: false,
                      })
                    : ""
            );
        });
    } catch (e) {
        // If rspack isn't configured or available, don't crash the server.
        console.log("rspack watch not started:", e && e.message ? e.message : e);
    }
}

start();
