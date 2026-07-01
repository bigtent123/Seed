import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { getReferenceFilesStore, jsonResponse } from "./seed-audio";

const maxFileSizeBytes = 10 * 1024 * 1024;
const allowedAudioTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/opus",
  "audio/pcm",
]);
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const getPublicFileUrl = (request: Request, id: string) => {
  const requestUrl = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto") || requestUrl.protocol.replace(":", "");
  const host = request.headers.get("host") || requestUrl.host;

  return `${protocol}://${host}/api/reference-file/${encodeURIComponent(id)}`;
};

const getExtension = (file: File) => {
  const extension = extname(file.name).toLowerCase();
  if (extension) return extension;
  if (file.type === "audio/mpeg" || file.type === "audio/mp3") return ".mp3";
  if (file.type.includes("wav")) return ".wav";
  if (file.type.includes("ogg") || file.type.includes("opus")) return ".ogg";
  if (file.type === "image/jpeg") return ".jpg";
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  return "";
};

const storeFile = async (request: Request, file: File, kind: "audio" | "image") => {
  if (file.size > maxFileSizeBytes) {
    throw new Error(`${file.name} is larger than the 10MB Seed Audio reference limit.`);
  }

  const allowedTypes = kind === "audio" ? allowedAudioTypes : allowedImageTypes;
  if (file.type && !allowedTypes.has(file.type)) {
    throw new Error(`${file.name} has unsupported type ${file.type}.`);
  }

  const id = `${randomUUID()}${getExtension(file)}`;
  const arrayBuffer = await file.arrayBuffer();
  const store = getReferenceFilesStore();

  await store.set(id, arrayBuffer, {
    metadata: {
      kind,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      uploadedAt: new Date().toISOString(),
    },
  });

  return {
    id,
    url: getPublicFileUrl(request, id),
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  };
};

export default async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed. Use POST." });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonResponse(400, { error: "Request must be multipart/form-data." });
  }

  const audioFiles = formData
    .getAll("audio")
    .filter((value): value is File => value instanceof File && value.size > 0)
    .slice(0, 3);
  const imageFile = formData.get("image");

  try {
    const audio = await Promise.all(audioFiles.map((file) => storeFile(request, file, "audio")));
    const image =
      imageFile instanceof File && imageFile.size > 0
        ? await storeFile(request, imageFile, "image")
        : undefined;

    return jsonResponse(200, {
      ok: true,
      audio,
      image,
    });
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
