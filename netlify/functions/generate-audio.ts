import type { Handler } from "@netlify/functions";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT =
  "https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create";

type GenerateAudioRequest = {
  prompt?: string;
  voice?: string;
  audioUrls?: string[];
  imageUrl?: string;
  outputFormat?: "wav" | "mp3" | "pcm" | "ogg_opus";
  sampleRate?: number;
  speed?: number;
  volume?: number;
  pitch?: number;
  advancedPayload?: unknown;
};

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
  },
  body: JSON.stringify(body),
});

const cleanString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const buildPayload = (input: GenerateAudioRequest) => {
  if (input.advancedPayload && typeof input.advancedPayload === "object") {
    return input.advancedPayload;
  }

  const prompt = cleanString(input.prompt);
  const audioUrls = Array.isArray(input.audioUrls)
    ? input.audioUrls.map(cleanString).filter(Boolean).slice(0, 3)
    : [];
  const payload: Record<string, unknown> = {
    model: "seed-audio-1.0",
    text_prompt: prompt,
  };

  const voice = cleanString(input.voice);
  const imageUrl = cleanString(input.imageUrl);
  if (voice) payload.voice = voice;
  if (audioUrls.length > 0) payload.audio_urls = audioUrls;
  if (imageUrl) payload.image_url = imageUrl;
  if (input.outputFormat) payload.output_format = input.outputFormat;
  if (isFiniteNumber(input.sampleRate)) payload.sample_rate = input.sampleRate;
  if (isFiniteNumber(input.speed)) payload.speed = input.speed;
  if (isFiniteNumber(input.volume)) payload.volume = input.volume;
  if (isFiniteNumber(input.pitch)) payload.pitch = input.pitch;

  return payload;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.SEED_AUDIO_API_KEY;
  const appId = process.env.SEED_AUDIO_APP_ID;
  const accessKey = process.env.SEED_AUDIO_ACCESS_KEY;
  const endpoint = process.env.SEED_AUDIO_ENDPOINT || DEFAULT_ENDPOINT;

  if (!apiKey && !(appId && accessKey)) {
    return json(500, {
      error:
        "Seed Audio credentials are not configured. Set SEED_AUDIO_API_KEY in Netlify, or set SEED_AUDIO_APP_ID and SEED_AUDIO_ACCESS_KEY for legacy auth.",
    });
  }

  let input: GenerateAudioRequest;
  try {
    input = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Request body must be valid JSON." });
  }

  if (!input.advancedPayload && !cleanString(input.prompt)) {
    return json(400, { error: "Prompt is required." });
  }

  const requestId = randomUUID();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-request-id": requestId,
  };

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  } else {
    headers["x-api-app-id"] = appId as string;
    headers["x-api-access-key"] = accessKey as string;
  }

  const payload = buildPayload(input);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const upstreamJson = await response.json();
      return json(response.ok ? 200 : response.status, {
        ok: response.ok,
        requestId,
        endpoint,
        payload,
        upstream: upstreamJson,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return json(response.ok ? 200 : response.status, {
      ok: response.ok,
      requestId,
      endpoint,
      payload,
      upstream: {
        content_type: contentType || "application/octet-stream",
        data_uri: `data:${contentType || "application/octet-stream"};base64,${base64}`,
      },
    });
  } catch (error) {
    return json(502, {
      error: "Seed Audio request failed.",
      detail: error instanceof Error ? error.message : String(error),
      endpoint,
      payload,
    });
  }
};
