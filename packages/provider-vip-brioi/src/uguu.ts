export const UGUU_ENDPOINT = "https://uguu.se/upload.php";
export const UGUU_HOST_SUFFIX = ".uguu.se";
export const UGUU_MAX_BYTES = 128 * 1024 * 1024;

export type UguuUploadInput = {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly filename?: string;
};

export type UguuUploadResult = {
  readonly url: string;
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
    throw new Error("Uguu upload requires an image, video, or audio MIME type");
  }
  return normalized;
}

function validateUguuUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Uguu returned an invalid URL");
  }
  if (
    parsed.protocol !== "https:"
    || (parsed.hostname !== "uguu.se" && !parsed.hostname.endsWith(UGUU_HOST_SUFFIX))
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname === "/"
  ) {
    throw new Error("Uguu returned a non-public media URL");
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

/** Verify that a URL can be fetched as the expected media type without credentials. */
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
  if (response.headers.get("content-length") === "0") {
    throw new Error("Public reference returned an empty response");
  }
  const actual = mediaTypeOf(response.headers.get("content-type"));
  if (actual !== expected) {
    throw new Error(`Public reference MIME type ${actual ?? "missing"} does not match ${expected}`);
  }
}

type UguuApiResponse = {
  success?: unknown;
  files?: unknown;
};

function uploadUrlFromResponse(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Uguu upload returned an invalid JSON response");
  }
  const body = value as UguuApiResponse;
  if (body.success !== true || !Array.isArray(body.files) || body.files.length === 0) {
    throw new Error("Uguu upload did not return a file URL");
  }
  const first = body.files[0];
  if (first === null || typeof first !== "object" || Array.isArray(first)) {
    throw new Error("Uguu upload did not return a file URL");
  }
  const url = (first as { url?: unknown }).url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("Uguu upload did not return a file URL");
  }
  return validateUguuUrl(url);
}

async function uploadOnce(input: UguuUploadInput, fetcher: Fetcher): Promise<UguuUploadResult> {
  const mediaType = validateMediaType(input.mediaType);
  if (input.bytes.byteLength > UGUU_MAX_BYTES) {
    throw new Error("Uguu upload exceeds the 128 MiB file limit");
  }

  const form = new FormData();
  form.append(
    "files[]",
    new Blob([ownedArrayBuffer(input.bytes)], { type: mediaType }),
    input.filename ?? filenameFor(mediaType),
  );

  const response = await fetcher(UGUU_ENDPOINT, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Uguu upload returned HTTP ${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Uguu upload returned invalid JSON");
  }
  const url = uploadUrlFromResponse(body);
  await verifyDirectMediaUrl(url, mediaType, fetcher);
  return { url };
}

export function createUguuUploader(options: {
  fetch?: Fetcher;
  maxAttempts?: number;
} = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  const maxAttempts = options.maxAttempts ?? 2;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    throw new Error("Uguu maxAttempts must be an integer from 1 to 3");
  }

  return {
    async upload(input: UguuUploadInput): Promise<UguuUploadResult> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await uploadOnce(input, fetcher);
        } catch (error) {
          lastError = error;
          if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Uguu upload failed");
    },
  };
}

export async function upload(input: UguuUploadInput): Promise<UguuUploadResult> {
  return createUguuUploader().upload(input);
}
