import { randomUUID } from "node:crypto";
import {
  cleanString,
  type GenerateAudioRequest,
  hasSeedAudioCredentials,
  jsonResponse,
  writeJob,
} from "./seed-audio";

const getBackgroundUrl = (request: Request) => {
  const requestUrl = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
  const host = request.headers.get("host") || requestUrl.host;

  return `${protocol}://${host}/.netlify/functions/generate-audio-worker`;
};

export default async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  if (!hasSeedAudioCredentials()) {
    return jsonResponse(500, {
      error:
        "Seed Audio credentials are not configured. Set SEED_AUDIO_API_KEY in Netlify, or set SEED_AUDIO_APP_ID and SEED_AUDIO_ACCESS_KEY for legacy auth.",
    });
  }

  let input: GenerateAudioRequest;
  try {
    input = (await request.json()) as GenerateAudioRequest;
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON." });
  }

  if (!input.advancedPayload && !cleanString(input.prompt)) {
    return jsonResponse(400, { error: "Prompt is required." });
  }

  const now = new Date().toISOString();
  const jobId = randomUUID();
  await writeJob({
    id: jobId,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    message: "Generation queued.",
  });

  const backgroundResponse = await fetch(getBackgroundUrl(request), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ jobId, input }),
  });

  if (!backgroundResponse.ok && backgroundResponse.status !== 202) {
    const detail = await backgroundResponse.text();
    await writeJob({
      id: jobId,
      status: "failed",
      createdAt: now,
      updatedAt: new Date().toISOString(),
      error: "Could not start background generation.",
      detail,
    });

    return jsonResponse(502, {
      ok: false,
      jobId,
      error: "Could not start background generation.",
      detail,
    });
  }

  return jsonResponse(202, {
    ok: true,
    jobId,
    status: "queued",
    statusUrl: `/api/generate-audio-status?jobId=${jobId}`,
    message: "Generation started. The app will poll until the audio is ready.",
  });
};
