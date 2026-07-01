# Seed Audio Studio

A Netlify-ready React app for generating audio with BytePlus Seed Audio 1.0.

The browser never receives your Seed Audio key. Requests go through a Netlify Function at
`/api/generate-audio`, which creates a job and starts the `generate-audio-background` Netlify
background function. The browser polls `/api/generate-audio-status` until the worker finishes. The
worker adds the required BytePlus authentication headers and forwards the payload to:

```txt
https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create
```

## Features

- Separate optional spoken script (`text_prompt`) and audio direction (`prompt`) fields, so Seed
  Audio can either speak exact copy or write its own copy from your direction.
- Optional voice, output format, sample rate, speed, volume, pitch, image URL, and up to three
  reference audio URLs.
- Local audio/image attachments. The app uploads them to Netlify Blobs and exposes temporary public
  URLs for Seed Audio to fetch.
- Target length control by adding an explicit duration instruction to `prompt`.
- Advanced raw JSON payload override for newly released BytePlus request fields.
- Audio playback/download when the API response contains an audio URL or data URI.
- Raw response viewer for debugging request IDs and upstream API responses.
- Async background generation for prompts that take longer than Netlify's synchronous function limit.

## Local development

```bash
npm install
cp .env.example .env
# Edit .env and add SEED_AUDIO_API_KEY.
npm run netlify:dev
```

Open the Netlify dev URL, usually `http://localhost:8888`.

## Environment variables

Set one authentication mode:

```bash
SEED_AUDIO_API_KEY=your-byteplus-seed-audio-api-key
```

or legacy credentials:

```bash
SEED_AUDIO_APP_ID=your-legacy-app-id
SEED_AUDIO_ACCESS_KEY=your-legacy-access-key
```

Optional:

```bash
SEED_AUDIO_ENDPOINT=https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/create
```

## Deploy to Netlify

### Option 1: Netlify UI

1. Create a new Netlify site from this repository and branch.
2. Netlify will read `netlify.toml`.
3. Confirm the build settings:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Add `SEED_AUDIO_API_KEY` in **Site configuration -> Environment variables**.
5. Deploy the site.

### Option 2: Netlify CLI

```bash
npm install
netlify login
netlify init
netlify env:set SEED_AUDIO_API_KEY "your-byteplus-seed-audio-api-key"
npm run netlify:deploy
```

## Notes

- The Lark guide lists a 120-second output limit per request.
- Reference audio clips should be 30 seconds or shorter and 10MB or smaller. The app supports up to
  three local audio attachments or URLs, referenced in the prompt as `@Audio1`, `@Audio2`, and
  `@Audio3`.
- Seed Audio image references cannot be combined with audio references.
- The docs and current BytePlus endpoint do not expose a reliable separate input field for exact
  output duration. The app controls length by inserting a target-duration sentence into `prompt`;
  keep direction prompts explicit, for example "make this 45 seconds".
- Leave **Spoken script** blank to let Seed Audio generate copy from **Audio direction**. The
  BytePlus endpoint still requires a non-empty `text_prompt`, so the app sends a short internal
  placeholder and tells the model not to read that placeholder aloud.
- If you do fill **Spoken script**, put only the words to be spoken there. Put radio-ad concepts,
  image guidance, music, ambience, sound effects, and style notes in **Audio direction**.
- The voice/cloned voice field is sent as `voice` in normal mode. If **Use advanced raw request
  payload** is enabled, the JSON editor is authoritative, so add or edit `voice` there too.
- If BytePlus changes optional request fields, enable **Use advanced raw request payload** in the app
  and paste the exact JSON body from the latest API documentation.
