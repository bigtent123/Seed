import { getReferenceFilesStore, jsonResponse } from "./seed-audio";

export default async (request: Request) => {
  if (request.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed. Use GET." });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id") || decodeURIComponent(url.pathname.split("/").pop() || "");
  if (!id) {
    return jsonResponse(400, { error: "id is required." });
  }

  const store = getReferenceFilesStore();
  const entry = await store.getWithMetadata(id, { type: "arrayBuffer" });

  if (!entry || !entry.data) {
    return jsonResponse(404, { error: "Reference file not found." });
  }

  const contentType =
    typeof entry.metadata?.contentType === "string"
      ? entry.metadata.contentType
      : "application/octet-stream";

  return new Response(entry.data, {
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=3600",
    },
  });
};
