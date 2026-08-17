import { serve } from "@hono/node-server";
import app from "./app.ts";

const port = Number.parseInt(process.env.PORT ?? "8000", 10);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Douyin parser is listening on http://localhost:${info.port}`);
  },
);
