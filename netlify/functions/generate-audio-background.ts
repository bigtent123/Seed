import {
  generateSeedAudio,
  type GenerateAudioRequest,
  jsonResponse,
  readJob,
  writeJob,
} from "./seed-audio";

type WorkerPayload = {
  jobId?: string;
  input?: GenerateAudioRequest;
};

export default async (request: Request) => {
  let payload: WorkerPayload;
  try {
    payload = (await request.json()) as WorkerPayload;
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON." });
  }

  const { jobId, input } = payload;
  if (!jobId || !input) {
    return jsonResponse(400, { error: "jobId and input are required." });
  }

  const existingJob = await readJob(jobId);
  const createdAt = existingJob?.createdAt || new Date().toISOString();

  await writeJob({
    id: jobId,
    status: "running",
    createdAt,
    updatedAt: new Date().toISOString(),
    message: "Generation is running on BytePlus Seed Audio.",
  });

  try {
    const result = await generateSeedAudio(input);
    await writeJob({
      id: jobId,
      status: result.ok ? "completed" : "failed",
      createdAt,
      updatedAt: new Date().toISOString(),
      message: result.ok ? "Generation complete." : "Seed Audio returned an error.",
      result,
      error: result.ok ? undefined : result.error || "Seed Audio returned an error.",
      detail: result.ok ? undefined : result.detail,
    });
  } catch (error) {
    await writeJob({
      id: jobId,
      status: "failed",
      createdAt,
      updatedAt: new Date().toISOString(),
      error: "Seed Audio request failed.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
};
