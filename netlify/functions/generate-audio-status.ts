import { jsonResponse, readJob } from "./seed-audio";

export default async (request: Request) => {
  if (request.method !== "GET" && request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use GET or POST." });
  }

  let jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (!jobId && request.method === "POST") {
    try {
      const body = (await request.json()) as { jobId?: string };
      jobId = body.jobId || "";
    } catch {
      return jsonResponse(400, { error: "Request body must be valid JSON." });
    }
  }

  if (!jobId) {
    return jsonResponse(400, { error: "jobId is required." });
  }

  const job = await readJob(jobId);
  if (!job) {
    return jsonResponse(404, { error: "Job not found." });
  }

  return jsonResponse(200, {
    ok: job.status === "completed",
    ...job,
  });
};
