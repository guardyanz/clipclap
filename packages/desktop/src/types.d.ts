declare module "@hyperframes/cli/wizard-server" {
  import type { Hono } from "hono";
  export function createWizardApp(): Hono;
}

declare module "@hyperframes/cli/studio-server" {
  import type { Hono } from "hono";
  export function createStudioServer(options: {
    projectDir: string;
    projectName?: string;
    autoProxy?: boolean;
  }): { app: Hono; watcher: { close?: () => void } };
}
