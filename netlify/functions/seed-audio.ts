import { getStore } from "@netlify/blobs";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT =
  "https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create";

export type GenerateAudioRequest = {
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

export type JobStatus = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  message?: string;
  result?: SeedAudioResult;
  error?: string;
  detail?: string;
};

export type SeedAudioResult = {
  ok: boolean;
  requestId: string;
  endpoint: string;
  payload: unknown;
  audio?: unknown;
  upstream?: unknown;
  error?: string;
  detail?: string;
};

export const jsonResponse = (status: number, body: unknown) =>
  Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });

export const cleanString = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const hasSeedAudioCredentials = () =>
  Boolean(
    process.env.SEED_AUDIO_API_KEY ||
      (process.env.SEED_AUDIO_APP_ID && process.env.SEED_AUDIO_ACCESS_KEY),
  );

export const getJobsStore = () => getStore("seed-audio-jobs");

export const readJob = async (jobId: string) =>
  (await getJobsStore().get(jobId, { type: "json" })) as JobStatus | null;

export const writeJob = async (job: JobStatus) => {
  await getJobsStore().setJSON(job.id, {
    ...job,
    updatedAt: new Date().toISOString(),
  });
};

const inferAudioMimeType = (base64Audio: string, outputFormat?: string) => {
  if (base64Audio.startsWith("UklGR")) return "audio/wav";
  if (base64Audio.startsWith("T2dn")) return "audio/ogg";
  if (base64Audio.startsWith("SUQz") || base64Audio.startsWith("//")) return "audio/mpeg";

  switch (outputFormat) {
    case "wav":
      return "audio/wav";
    case "ogg_opus":
      return "audio/ogg";
    case "pcm":
      return "audio/L16";
    default:
      return "audio/mpeg";
  }
};

const normalizeAudio = (upstream: unknown, input: GenerateAudioRequest) => {
  if (!upstream || typeof upstream !== "object") return undefined;

  const upstreamRecord = upstream as Record<string, unknown>;
  const audioUrl = upstreamRecord.url;
  const audioBase64 = upstreamRecord.audio;

  if (typeof audioUrl === "string" && audioUrl.length > 0) {
    return {
      url: audioUrl,
      duration: upstreamRecord.duration,
      original_duration: upstreamRecord.original_duration,
    };
  }

  if (typeof audioBase64 === "string" && audioBase64.length > 0) {
    const contentType = inferAudioMimeType(audioBase64, input.outputFormat);
    return {
      content_type: contentType,
      data_uri: `data:${contentType};base64,${audioBase64}`,
      duration: upstreamRecord.duration,
      original_duration: upstreamRecord.original_duration,
    };
  }

  return undefined;
};

const sanitizeUpstream = (upstream: unknown) => {
  if (!upstream || typeof upstream !== "object") return upstream;

  const sanitized = JSON.parse(JSON.stringify(upstream)) as Record<string, unknown>;
  if (typeof sanitized.audio === "string" && sanitized.audio.length > 1024) {
    sanitized.audio = `[base64 audio omitted: ${sanitized.audio.length} characters]`;
  }

  return sanitized;
};

export const buildPayload = (input: GenerateAudioRequest) => {
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

export const generateSeedAudio = async (input: GenerateAudioRequest): Promise<SeedAudioResult> => {
  const apiKey = process.env.SEED_AUDIO_API_KEY;
  const appId = process.env.SEED_AUDIO_APP_ID;
  const accessKey = process.env.SEED_AUDIO_ACCESS_KEY;
  const endpoint = process.env.SEED_AUDIO_ENDPOINT || DEFAULT_ENDPOINT;

  if (!apiKey && !(appId && accessKey)) {
    throw new Error(
      "Seed Audio credentials are not configured. Set SEED_AUDIO_API_KEY in Netlify, or set SEED_AUDIO_APP_ID and SEED_AUDIO_ACCESS_KEY for legacy auth.",
    );
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
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const upstreamJson = await response.json();
    const audio = normalizeAudio(upstreamJson, input);
    return {
      ok: response.ok,
      requestId,
      endpoint,
      payload,
      audio,
      upstream: sanitizeUpstream(upstreamJson),
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const normalizedContentType = contentType || "application/octet-stream";

  return {
    ok: response.ok,
    requestId,
    endpoint,
    payload,
    audio: {
      content_type: normalizedContentType,
      data_uri: `data:${normalizedContentType};base64,${base64}`,
    },
    upstream: {
      content_type: normalizedContentType,
    },
  };
};
