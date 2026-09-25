import { createFileRoute } from "@tanstack/react-router";
import { proxyVenice } from "@/lib/venice-proxy.server";

const handle = ({ request }: { request: Request }) => proxyVenice(request);

export const Route = createFileRoute("/api/venice/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
