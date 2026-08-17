import app from "./_generated/app.js";

export default async function handler(req: any, res: any) {
  await writeHonoResponse(req, res);
}

async function writeHonoResponse(req: any, res: any): Promise<void> {
  try {
    const response = await app.fetch(toWebRequest(req));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: "internal server error", error: { detail: String(error) } }));
  }
}

function toWebRequest(req: any): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const proto = headers.get("x-forwarded-proto") ?? "https";
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }
  return new Request(url, init);
}
