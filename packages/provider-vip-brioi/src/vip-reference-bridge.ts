import type { GenerationMediaValue, GenerationRequest } from "@hypit/hypit/generation";
import { createLitterboxUploader, verifyDirectMediaUrl } from "./catbox-litterbox.js";
import { buildVipVideoRequest } from "./vip-request.js";

type PublicAssetUploader = ReturnType<typeof createLitterboxUploader>;
type ResourceStore = { get(id: string): Promise<Uint8Array | undefined> };
type VipReference = {
  url: string;
  type: "image" | "video" | "audio";
  role?: "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame";
};

function text(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${subject} must be non-empty text`);
  return value;
}

function mediaItems(ports: GenerationRequest["ports"], name: string): readonly GenerationMediaValue[] {
  return (ports[name] ?? []) as readonly GenerationMediaValue[];
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function referenceRole(type: VipReference["type"], frameRole?: "first_frame" | "last_frame"): VipReference["role"] {
  if (frameRole !== undefined) return frameRole;
  return type === "image" ? "reference_image" : type === "video" ? "reference_video" : "reference_audio";
}

export async function compileVipVideoRequest(
  model: string,
  request: GenerationRequest,
  resources: ResourceStore,
  options: {
    fetch?: typeof globalThis.fetch;
    uploader?: PublicAssetUploader;
  } = {},
) {
  const ports = request.ports;
  const fetcher = options.fetch ?? globalThis.fetch;
  const uploader = options.uploader ?? createLitterboxUploader({ fetch: fetcher });
  const refs: VipReference[] = [];
  const publicByResource = new Map<string, string>();
  const publicByContent = new Map<string, string>();

  async function resolve(items: readonly GenerationMediaValue[], type: VipReference["type"], frameRole?: "first_frame" | "last_frame") {
    for (const item of items) {
      const artifact = item.artifact;
      const resource = artifact.resource;
      const mediaType = artifact.mediaType;
      if (!mediaType.toLowerCase().startsWith(`${type}/`)) {
        throw new Error(`Reference media type ${mediaType} does not match ${type}`);
      }

      let url = publicByResource.get(resource);
      if (url === undefined && isHttpsUrl(resource)) {
        await verifyDirectMediaUrl(resource, mediaType, fetcher);
        url = resource;
        publicByResource.set(resource, url);
      }
      if (url === undefined) {
        const bytes = await resources.get(resource);
        if (bytes === undefined) throw new Error(`Reference resource ${resource} is unavailable`);
        const contentKey = `${mediaType.toLowerCase()}:${await sha256(bytes)}`;
        url = publicByContent.get(contentKey);
        if (url === undefined) {
          const uploaded = await uploader.upload({ bytes, mediaType });
          url = uploaded.url;
          publicByContent.set(contentKey, url);
        }
        publicByResource.set(resource, url);
      }
      refs.push({ url, type, role: referenceRole(type, frameRole) });
    }
  }

  await resolve(mediaItems(ports, "referenceImage"), "image");
  await resolve(mediaItems(ports, "referenceVideo"), "video");
  await resolve(mediaItems(ports, "referenceAudio"), "audio");
  await resolve(mediaItems(ports, "firstFrame"), "image", "first_frame");
  await resolve(mediaItems(ports, "lastFrame"), "image", "last_frame");
  const prompt = text(ports.prompt?.[0], "VIP prompt");
  const duration = Number(ports.duration?.[0]);
  return buildVipVideoRequest({
    model: text(model, "Seedance model"),
    prompt,
    duration,
    resolution: String(ports.resolution?.[0] ?? "720p"),
    aspectRatio: String(ports.aspectRatio?.[0] ?? "9:16"),
    refs,
    generateAudio: ports.generateAudio?.[0] === true,
    webSearch: ports.webSearch?.[0] === true,
  });
}

