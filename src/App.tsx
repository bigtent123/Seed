import { FormEvent, useMemo, useState } from "react";

type OutputFormat = "mp3" | "wav" | "pcm" | "ogg_opus";

type GenerateResponse = {
  ok?: boolean;
  error?: string;
  detail?: string;
  jobId?: string;
  status?: "queued" | "running" | "completed" | "failed";
  message?: string;
  result?: GenerateResponse;
  audio?: unknown;
  requestId?: string;
  endpoint?: string;
  payload?: unknown;
  upstream?: unknown;
};

type UploadedReference = {
  url: string;
  fileName: string;
  contentType: string;
  size: number;
};

type UploadReferenceResponse = {
  ok?: boolean;
  error?: string;
  audio?: UploadedReference[];
  image?: UploadedReference;
};

const sampleRates = [8000, 16000, 24000, 32000, 44100, 48000];
const formats: OutputFormat[] = ["mp3", "wav", "pcm", "ogg_opus"];
const pollDelayMs = 3000;
const maxPollAttempts = 200;
const maxReferenceFileBytes = 10 * 1024 * 1024;

const defaultPrompt =
  "Create a 20-second cinematic technology podcast intro. Write a short welcome line, use a confident warm narrator, add subtle synth pulses, and end with a clean logo hit.";

const getByPath = (value: unknown, path: string[]) =>
  path.reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, value);

const findAudioSource = (value: unknown): string | null => {
  const priorityPaths = [
    ["audio", "url"],
    ["audio", "data_uri"],
    ["audio", "audio_url"],
    ["upstream", "audio", "url"],
    ["upstream", "url"],
    ["upstream", "audio_url"],
    ["upstream", "output_audio_url"],
    ["upstream", "result", "audio", "url"],
    ["upstream", "data", "audio", "url"],
    ["upstream", "data", "audio_url"],
    ["upstream", "data", "url"],
    ["upstream", "data_uri"],
    ["upstream", "content", "data_uri"],
  ];

  for (const path of priorityPaths) {
    const candidate = getByPath(value, path);
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  const seen = new Set<unknown>();
  const walk = (node: unknown, keyHint = ""): string | null => {
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);

    for (const [key, child] of Object.entries(node)) {
      if (
        typeof child === "string" &&
        child.length > 0 &&
        (key.toLowerCase().includes("url") || key.toLowerCase().includes("data_uri") || keyHint === "audio") &&
        (child.startsWith("http") || child.startsWith("data:"))
      ) {
        return child;
      }
      const nested = walk(child, key.toLowerCase());
      if (nested) return nested;
    }

    return null;
  };

  return walk(value);
};

const sleep = (durationMs: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });

const formatFileSize = (size: number) => `${(size / (1024 * 1024)).toFixed(2)} MB`;
const clampTargetDuration = (duration: number) =>
  Number.isFinite(duration) ? Math.min(120, Math.max(1, Math.round(duration))) : 20;

function App() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [voice, setVoice] = useState("");
  const [audioUrls, setAudioUrls] = useState(["", "", ""]);
  const [audioFiles, setAudioFiles] = useState<(File | null)[]>([null, null, null]);
  const [imageUrl, setImageUrl] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [targetDurationSeconds, setTargetDurationSeconds] = useState(20);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp3");
  const [sampleRate, setSampleRate] = useState(24000);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [useAdvancedPayload, setUseAdvancedPayload] = useState(false);
  const [advancedPayload, setAdvancedPayload] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [audioSource, setAudioSource] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const generatedPayload = useMemo(() => {
    const targetDuration = clampTargetDuration(targetDurationSeconds);
    const textPromptParts = [
      prompt,
      `Target length: approximately ${targetDuration} seconds. Keep the generated audio within this duration.`,
      imageUrl.trim()
        ? "Use the attached image as visual reference for the character, company, mood, and audio style."
        : "",
    ].filter(Boolean);
    const payload: Record<string, unknown> = {
      model: "seed-audio-1.0",
      text_prompt: textPromptParts.join("\n\n"),
      output_format: outputFormat,
      sample_rate: sampleRate,
      speed,
      volume,
    };
    const cleanedAudioUrls = audioUrls.map((url) => url.trim()).filter(Boolean);

    if (voice.trim()) payload.voice = voice.trim();
    if (cleanedAudioUrls.length > 0) payload.audio_urls = cleanedAudioUrls;
    if (imageUrl.trim()) payload.image_url = imageUrl.trim();
    if (pitch !== 0) payload.pitch = pitch;

    return payload;
  }, [
    audioUrls,
    imageUrl,
    outputFormat,
    pitch,
    prompt,
    sampleRate,
    speed,
    targetDurationSeconds,
    voice,
    volume,
  ]);

  const payloadPreview = JSON.stringify(generatedPayload, null, 2);

  const updateAudioUrl = (index: number, value: string) => {
    setAudioUrls((current) =>
      current.map((url, currentIndex) => (currentIndex === index ? value : url)),
    );
  };

  const updateAudioFile = (index: number, file: File | null) => {
    setAudioFiles((current) =>
      current.map((currentFile, currentIndex) => (currentIndex === index ? file : currentFile)),
    );
  };

  const toggleAdvancedPayload = (checked: boolean) => {
    setUseAdvancedPayload(checked);
    if (checked && !advancedPayload) {
      setAdvancedPayload(payloadPreview);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsGenerating(true);
    setError(null);
    setAudioSource(null);
    setResult(null);
    setStatusMessage("Starting generation...");

    const selectedAudioFiles = audioFiles.filter((file): file is File => Boolean(file));
    const selectedAudioUrls = audioUrls.map((url) => url.trim()).filter(Boolean);
    const hasAudioReferences = selectedAudioFiles.length > 0 || selectedAudioUrls.length > 0;
    const hasImageReference = Boolean(imageUrl.trim() || imageFile);

    if (!useAdvancedPayload && hasAudioReferences && hasImageReference) {
      setIsGenerating(false);
      setError("Seed Audio reference image input cannot be combined with audio references. Use audio or image, not both.");
      return;
    }

    const oversizedFile = [...selectedAudioFiles, imageFile].find(
      (file): file is File => Boolean(file && file.size > maxReferenceFileBytes),
    );
    if (oversizedFile) {
      setIsGenerating(false);
      setError(`${oversizedFile.name} is ${formatFileSize(oversizedFile.size)}. Reference files must be 10MB or smaller.`);
      return;
    }

    let requestBody: Record<string, unknown>;
    try {
      const uploadedReferences =
        !useAdvancedPayload && (selectedAudioFiles.length > 0 || imageFile)
          ? await uploadReferences(selectedAudioFiles, imageFile)
          : undefined;

      requestBody = useAdvancedPayload
        ? { advancedPayload: JSON.parse(advancedPayload) }
        : {
            prompt,
            voice,
            audioUrls: [
              ...selectedAudioUrls,
              ...((uploadedReferences?.audio || []).map((reference) => reference.url)),
            ],
            imageUrl: imageUrl.trim() || uploadedReferences?.image?.url || "",
            targetDurationSeconds,
            outputFormat,
            sampleRate,
            speed,
            volume,
            pitch,
          };
    } catch (parseError) {
      setIsGenerating(false);
      setError(parseError instanceof Error ? parseError.message : "Advanced payload is invalid JSON.");
      return;
    }

    try {
      const response = await fetch("/api/generate-audio", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
      const data = (await response.json()) as GenerateResponse;

      setResult(data);
      setAudioSource(findAudioSource(data));
      if (!response.ok || data.ok === false) {
        setError(data.error || data.detail || "Seed Audio returned an error.");
      } else if (response.status === 202 && data.jobId) {
        setStatusMessage(data.message || "Generation queued...");
        await pollGeneration(data.jobId);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not reach the API proxy.");
    } finally {
      setIsGenerating(false);
    }
  };

  const uploadReferences = async (files: File[], image: File | null) => {
    setStatusMessage("Uploading reference files...");
    const formData = new FormData();
    files.slice(0, 3).forEach((file) => formData.append("audio", file));
    if (image) formData.append("image", image);

    const response = await fetch("/api/upload-reference", {
      method: "POST",
      body: formData,
    });
    const data = (await response.json()) as UploadReferenceResponse;

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "Reference upload failed.");
    }

    return data;
  };

  const pollGeneration = async (jobId: string) => {
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      await sleep(pollDelayMs);

      const response = await fetch(`/api/generate-audio-status?jobId=${encodeURIComponent(jobId)}`);
      const data = (await response.json()) as GenerateResponse;
      const displayResult = data.result || data;

      setResult(data);
      setAudioSource(findAudioSource(displayResult));
      setStatusMessage(data.message || `Generation ${data.status || "running"}...`);

      if (!response.ok || data.status === "failed") {
        setError(data.error || data.detail || "Seed Audio returned an error.");
        return;
      }

      if (data.status === "completed") {
        setResult(displayResult);
        setAudioSource(findAudioSource(displayResult));
        setStatusMessage("Generation complete.");
        return;
      }
    }

    setError("Generation is still running. Refresh the page and try again in a moment.");
  };

  return (
    <main className="app">
      <section className="hero">
        <p className="eyebrow">BytePlus Seed Audio 1.0</p>
        <h1>Generate finished audio scenes from a prompt.</h1>
        <p>
          This Netlify app keeps your Seed Audio key in a serverless function, then sends prompts and
          optional references to the BytePlus HTTP endpoint.
        </p>
      </section>

      <section className="grid">
        <form className="panel form-panel" onSubmit={submit}>
          <label className="field field-full">
            <span>Prompt (text_prompt)</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={9} />
            <small>
              Per the BytePlus guide, this is the required Seed Audio prompt field. Use it for the full scene request:
              dialogue, narration, image guidance, music, ambience, and sound effects.
            </small>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Voice or cloned voice ID</span>
              <input
                value={voice}
                onChange={(event) => setVoice(event.target.value)}
                placeholder="Optional preset voice"
              />
              <small>Normal mode sends this as <code>voice</code>. If raw payload mode is enabled, edit the JSON too.</small>
            </label>

            <label className="field">
              <span>Output format</span>
              <select
                value={outputFormat}
                onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
              >
                {formats.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Target length</span>
              <input
                type="number"
                min="1"
                max="120"
                step="1"
                value={targetDurationSeconds}
                onChange={(event) => setTargetDurationSeconds(Number(event.target.value))}
              />
              <small>BytePlus documents a 120s max. The app controls length by adding this instruction to the prompt.</small>
            </label>

            <label className="field">
              <span>Sample rate</span>
              <select
                value={sampleRate}
                onChange={(event) => setSampleRate(Number(event.target.value))}
              >
                {sampleRates.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate} Hz
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Speed</span>
              <input
                type="number"
                min="0.5"
                max="2"
                step="0.1"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              />
            </label>

            <label className="field">
              <span>Volume</span>
              <input
                type="number"
                min="0.1"
                max="2"
                step="0.1"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>

            <label className="field">
              <span>Pitch</span>
              <input
                type="number"
                min="-12"
                max="12"
                step="1"
                value={pitch}
                onChange={(event) => setPitch(Number(event.target.value))}
              />
            </label>
          </div>

          <fieldset className="references">
            <legend>Reference inputs</legend>
            <p>
              Use public URLs or attach local files. Audio references can be mentioned in your prompt as @Audio1,
              @Audio2, and @Audio3. Reference files must be 10MB or smaller; audio clips should be 30 seconds or
              shorter.
            </p>
            {audioUrls.map((url, index) => (
              <div className="reference-pair" key={`audio-${index + 1}`}>
                <label className="field">
                  <span>Audio URL {index + 1}</span>
                  <input
                    value={url}
                    onChange={(event) => updateAudioUrl(index, event.target.value)}
                    placeholder="https://example.com/reference.mp3"
                  />
                </label>
                <label className="field">
                  <span>Or attach audio file {index + 1}</span>
                  <input
                    type="file"
                    accept="audio/*,.wav,.mp3,.ogg,.opus,.pcm"
                    onChange={(event) => updateAudioFile(index, event.target.files?.[0] || null)}
                  />
                  {audioFiles[index] ? <small>{audioFiles[index]?.name} ({formatFileSize(audioFiles[index]!.size)})</small> : null}
                </label>
              </div>
            ))}
            <label className="field">
              <span>Image URL</span>
              <input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://example.com/reference.png"
              />
            </label>
            <label className="field">
              <span>Or attach image file</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setImageFile(event.target.files?.[0] || null)}
              />
              {imageFile ? <small>{imageFile.name} ({formatFileSize(imageFile.size)})</small> : null}
            </label>
            <p>Image references cannot be combined with audio references for Seed Audio.</p>
          </fieldset>

          <label className="toggle">
            <input
              type="checkbox"
              checked={useAdvancedPayload}
              onChange={(event) => toggleAdvancedPayload(event.target.checked)}
            />
            <span>Use advanced raw request payload</span>
          </label>

          <label className="field field-full">
            <span>{useAdvancedPayload ? "Advanced payload override" : "Payload preview"}</span>
            <textarea
              className="code"
              value={useAdvancedPayload ? advancedPayload : payloadPreview}
              readOnly={!useAdvancedPayload}
              onChange={(event) => setAdvancedPayload(event.target.value)}
              rows={12}
            />
          </label>

          <button disabled={isGenerating || (!prompt.trim() && !useAdvancedPayload)} type="submit">
            {isGenerating ? "Generating..." : "Generate audio"}
          </button>
        </form>

        <aside className="panel output-panel">
          <h2>Result</h2>
          {statusMessage ? <div className="status-card">{statusMessage}</div> : null}
          {error ? <div className="alert">{error}</div> : null}
          {audioSource ? (
            <div className="audio-card">
              <audio controls src={audioSource} />
              <a href={audioSource} download={`seed-audio.${outputFormat}`} target="_blank" rel="noreferrer">
                Download generated audio
              </a>
            </div>
          ) : (
            <div className="empty-state">
              <p>Your generated audio player will appear here when the API returns a URL or data URI.</p>
            </div>
          )}

          <div className="setup">
            <h3>Netlify environment</h3>
            <p>Set one of these credential modes before deploying:</p>
            <pre>{`SEED_AUDIO_API_KEY=your-byteplus-api-key

# Optional override:
SEED_AUDIO_ENDPOINT=https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create

# Legacy alternative:
SEED_AUDIO_APP_ID=your-app-id
SEED_AUDIO_ACCESS_KEY=your-access-key`}</pre>
          </div>

          {result ? (
            <details open>
              <summary>Raw response</summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

export default App;
