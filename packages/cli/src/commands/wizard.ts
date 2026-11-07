import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Open the wizard (pick a template, fill a form, render)", "clipclap wizard"],
  ["Use a specific port", "clipclap wizard --port 4600"],
  ["Start without opening the browser", "clipclap wizard --no-open"],
];

const DEFAULT_PORT = 4600;
const MAX_PORT_SCAN = 20;

export default defineCommand({
  meta: {
    name: "wizard",
    description:
      "Proof-of-concept few-click UI: pick a template, fill a form, render — no HTML editing required",
  },
  args: {
    port: {
      type: "string",
      description: `Port to listen on (default: ${DEFAULT_PORT}, scans upward if taken)`,
    },
    open: {
      type: "boolean",
      description: "Open the browser automatically",
      default: true,
    },
  },
  async run({ args }) {
    const { createWizardApp } = await import("../server/wizardServer.js");
    const { createAdaptorServer } = await import("@hono/node-server");

    const app = createWizardApp();
    const server = createAdaptorServer({ fetch: app.fetch });

    const startPort = args.port ? Number(args.port) : DEFAULT_PORT;
    let boundPort: number | null = null;

    for (let port = startPort; port < startPort + MAX_PORT_SCAN; port++) {
      try {
        await new Promise<void>((resolveListener, rejectListener) => {
          const onError = (err: NodeJS.ErrnoException) => {
            server.removeListener("listening", onListening);
            rejectListener(err);
          };
          const onListening = () => {
            server.removeListener("error", onError);
            resolveListener();
          };
          server.once("error", onError);
          server.once("listening", onListening);
          server.listen(port, "127.0.0.1");
        });
        boundPort = port;
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
      }
    }

    if (boundPort === null) {
      console.error(c.error(`Could not find a free port starting from ${startPort}.`));
      process.exitCode = 1;
      return;
    }

    const url = `http://127.0.0.1:${boundPort}`;
    console.log(`\n  ${c.bold("ClipClap Wizard")} running at ${c.accent(url)}`);
    console.log(`  ${c.dim("Press Ctrl+C to stop.")}\n`);

    if (args.open) {
      const { default: open } = await import("open");
      await open(url).catch(() => {
        console.log(c.dim(`  (Couldn't auto-open a browser — visit ${url} manually.)`));
      });
    }
  },
});
