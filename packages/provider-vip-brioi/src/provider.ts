import { canonicalize, defineEndpointPackage, wakeAfter } from "@hypit/hypit/endpoint-kit";
import type { AsyncEndpoint, CredentialRef, EndpointRequest } from "@hypit/hypit/endpoint-kit";
import { generationTypes, sealGeneratedVideoSet } from "@hypit/hypit/generation";
import type { GenerationMediaValue, GenerationRequest } from "@hypit/hypit/generation";
import { buildVipVideoRequest, extractVipResultUrl, mapVipTaskStatus } from "./vip-request.js";

export const providerModule = { name: "@infinite-replica/provider-vip-brioi", version: "1" } as const;

const capabilities = [
  { module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2" },
  { module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2-fast" },
  { module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2-mini" },
] as const;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("VIP response must be an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${subject} must be non-empty text`);
  return value;
}

function secretOf(credentials: Readonly<Record<string, { secret: string }>>): string {
  return text(credentials.apiKey?.secret, "VIP API key");
}

function mediaItems(ports: GenerationRequest["ports"], name: string): readonly GenerationMediaValue[] {
  return (ports[name] ?? []) as readonly GenerationMediaValue[];
}

function support(request: EndpointRequest) {
  const ports = (request.constraints as unknown as GenerationRequest).ports;
  const unsupported = ["generateAudio", "webSearch"].some((name) => ports[name]?.[0] === true);
  if (unsupported) return { status: "unsupported" as const, reason: "VIP Seedance 2 does not expose this requested option" };
  if (ports.aspectRatio?.[0] === "adaptive") return { status: "unsupported" as const, reason: "VIP Seedance 2 does not expose adaptive aspect ratio" };
  const model = request.capability.name;
  if (!capabilities.some((item) => item.name === model)) return { status: "unsupported" as const, reason: `Unsupported Seedance capability ${model}` };
  return { status: "supported" as const };
}

export function createVipVideoProvider(options: {
  instance: string;
  pool: string;
  baseUrl: string;
  apiKey: CredentialRef;
  concurrency?: number;
  pollIntervalMs?: number;
  fetch?: typeof globalThis.fetch;
}) {
  const base = new URL(options.baseUrl);
  if (base.protocol !== "https:") throw new Error("VIP baseUrl must use HTTPS");
  const origin = base.href.replace(/\/$/u, "");
  const fetcher = options.fetch ?? globalThis.fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;

  async function json(path: string, secret: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const response = await fetcher(`${origin}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`VIP ${init.method ?? "GET"} ${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
    return object(body);
  }

  async function compileRequest(model: string, request: GenerationRequest, resources: { get(id: string): Promise<Uint8Array | undefined> }) {
    const ports = request.ports;
    const refs: Array<{ url: string; type: "image" | "video" | "audio"; role?: "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame" }> = [];
    async function resolve(items: readonly GenerationMediaValue[], type: "image" | "video" | "audio", role?: "first_frame" | "last_frame") {
      for (const item of items) {
        const artifact = item.artifact as { resource?: string };
        const resource = artifact.resource;
        if (typeof resource !== "string") throw new Error("VIP Provider requires a public URL resource bridge for references");
        const bytes = await resources.get(resource);
        if (bytes === undefined) throw new Error(`Reference resource ${resource} is unavailable`);
        throw new Error("VIP Provider cannot turn a local resource into a public HTTPS URL without a configured storage bridge");
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

  const endpoint: AsyncEndpoint = {
    async start(context) {
      const supported = support(context.need);
      if (supported.status === "unsupported") throw new Error(supported.reason);
      const request = await compileRequest(context.need.capability.name, context.need.constraints as unknown as GenerationRequest, context.resources);
      const task = await json("/v1/videos", secretOf(context.credentials), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const id = text(task.id, "VIP task id");
      const handle = { id };
      await context.checkpoint?.({ handle, receipt: { id } });
      return { ...wakeAfter(handle, pollIntervalMs), receipt: { id } };
    },
    async poll(context) {
      const id = text(object(context.handle).id, "VIP task id");
      const task = await json(`/v1/videos/${encodeURIComponent(id)}`, secretOf(context.credentials));
      const status = mapVipTaskStatus(text(task.status, "VIP task status"));
      if (status === "pending") return wakeAfter({ id }, pollIntervalMs, Date.now(), { phase: String(task.status) });
      if (status === "failed") {
        const error = object(task.error ?? {});
        return { status: "failed", receipt: { id }, failure: { code: text(error.code ?? "VIP_VIDEO_FAILED", "VIP error code"), message: text(error.message ?? "VIP video task failed", "VIP error message") } };
      }
      return { status: "ready", handle: { id, url: extractVipResultUrl(task) }, receipt: { id } };
    },
    async collect(context) {
      const url = text(object(context.handle).url, "VIP result URL");
      const response = await fetcher(url, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok) throw new Error(`VIP result download returned HTTP ${response.status}`);
      const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim();
      if (!mediaType?.startsWith("video/")) throw new Error("VIP result is not a video");
      const artifact = await context.resources.put(new Uint8Array(await response.arrayBuffer()), mediaType);
      return {
        status: "completed",
        result: { value: { kind: "inline", value: canonicalize(sealGeneratedVideoSet({ videos: [artifact] })) } },
      };
    },
  };

  return defineEndpointPackage({
    module: providerModule,
    facet: "videos",
    instance: options.instance,
    pool: options.pool,
    credentials: { apiKey: options.apiKey },
    credentialInputs: { apiKey: { label: "VIP API key" } },
    defaultConcurrency: options.concurrency ?? 1,
    actionLimits: { submit: { concurrency: 1 }, poll: { concurrency: 4 }, collect: { concurrency: 2 } },
    capabilities: capabilities.map((capability) => ({ capability, returns: generationTypes.videoSet, lifecycle: "asynchronous" as const, supports: support, endpoint })),
  });
}
