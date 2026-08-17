import app from "./app.ts";

declare const Deno: {
  env?: { get: (key: string) => string | undefined };
  serve: (
    options: { port: number } | ((request: Request) => Response | Promise<Response>),
    handler?: (request: Request) => Response | Promise<Response>,
  ) => unknown;
};

const port = Number.parseInt(Deno.env?.get("PORT") ?? "8000", 10);
Deno.serve({ port }, app.fetch);
