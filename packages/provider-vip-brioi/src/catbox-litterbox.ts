export const LITTERBOX_ENDPOINT = "https://litterbox.catbox.moe/resources/internals/api.php";
export const LITTERBOX_RETENTION = "72h" as const;
export const LITTERBOX_HOST = "litter.catbox.moe";

export type LitterboxUploadInput = {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename?: string;
};

export type LitterboxUploadResult = {
  readonly url: string;
  readonly retention: typeof LITTERBOX_RETENTION;
};

type Fetcher = typeof globalThis.fetch;

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function mediaTypeOf(value: string | null): string | undefined {
  const valueWithoutParameters = value?.split(";", 1)[0]?.trim().toLowerCase();
  return valueWithoutParameters || undefined;
}

function validateMediaType(mediaType: string): string {
  const normalized = mediaTypeOf(mediaType);
  if (normalized === undefined || !/^(?:image|video|audio)\/[a-z0-9.+-]+$/u.test(normalized)) {
    throw new Error(`Litterbox upload requires an image, video, or audio MIME type`);
  }
  return normalized;
}

function validateLitterboxUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Litterbox returned an invalid URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== LITTERBOX_HOST
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname === "/"
  ) {
    throw new Error("Litterbox returned a non-public media URL");
  }
  return parsed.href;
}

function filenameFor(mediaType: string): string {
  const extension = mediaType.split("/", 2)[1]?.replace(/[^a-z0-9]+/giu, "") || "bin";
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `input-${id}.${extension}`;
}

function responseIsReadable(response: Response): boolean {
  return response.ok || response.status === 206;
}

/**
 * Verify that a URL can be fetched as the expected media type without credentials.
 * HEAD is preferred; a one-byte Range GET handles origins that reject HEAD.
 */
export async function verifyDirectMediaUrl(
  url: string,
  expectedMediaType: string,
  fetcher: Fetcher = globalThis.fetch,
): Promise<void> {
  const expected = validateMediaType(expectedMediaType);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Public reference must be a valid URL");
  }
  if (parsed.protocol !== "https:") throw new Error("Public reference must use HTTPS");

  let response = await fetcher(parsed.href, {
    method: "HEAD",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 405 || response.status === 501) {
    response = await fetcher(parsed.href, {
      headers: { range: "bytes=0-0" },
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!responseIsReadable(response)) {
    throw new Error(`Public reference preflight returned HTTP ${response.status}`);
  }
  const actual = mediaTypeOf(response.headers.get("content-type"));
  if (actual !== expected) {
    throw new Error(`Public reference MIME type ${actual ?? "missing"} does not match ${expected}`);
  }
}

async function uploadOnce(
  input: LitterboxUploadInput,
  fetcher: Fetcher,
): Promise<LitterboxUploadResult> {
  const mediaType = validateMediaType(input.mediaType);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", LITTERBOX_RETENTION);
  form.append(
    "fileToUpload",
    new Blob([ownedArrayBuffer(input.bytes)], { type: mediaType }),
    input.filename ?? filenameFor(mediaType),
  );

  const response = await fetcher(LITTERBOX_ENDPOINT, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await response.text()).trim();
  if (!response.ok) throw new Error(`Litterbox upload returned HTTP ${response.status}`);
  const url = validateLitterboxUrl(body);
  await verifyDirectMediaUrl(url, mediaType, fetcher);
  return { url, retention: LITTERBOX_RETENTION };
}

export function createLitterboxUploader(options: {
  fetch?: Fetcher;
  maxAttempts?: number;
} = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Litterbox maxAttempts must be an integer from 1 to 3");
  }

  return {
    async upload(input: LitterboxUploadInput): Promise<LitterboxUploadResult> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await uploadOnce(input, fetcher);
        } catch (error) {
          lastError = error;
          if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Litterbox upload failed");
    },
  };
}

/** Upload with the default global fetcher; Providers use the factory above to inject their fetcher. */
export async function upload(input: LitterboxUploadInput): Promise<LitterboxUploadResult> {
  return createLitterboxUploader().upload(input);
}
