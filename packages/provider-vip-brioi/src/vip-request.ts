export type VipReference = {
  url: string;
  type: "image" | "video" | "audio";
  role?: "reference_image" | "reference_video" | "reference_audio" | "first_frame" | "last_frame";
};

export type VipVideoRequest = {
  model: "seedance-2-0" | "seedance-2-0-fast" | "seedance-2-0-mini" | "seedance-2-5";
  prompt: string;
  duration: number;
  resolution: "480p" | "720p" | "1080p" | "4K";
  aspect_ratio: "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  ref?: VipReference[];
};

const MODEL_MAP: Record<string, VipVideoRequest["model"]> = {
  "seedance-2": "seedance-2-0",
  "seedance-2-fast": "seedance-2-0-fast",
  "seedance-2-mini": "seedance-2-0-mini",
  "seedance-2.5": "seedance-2-5",
};

const RESOLUTION_MAP: Record<string, VipVideoRequest["resolution"]> = {
  "480p": "480p",
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4K",
  "4K": "4K",
};

const ASPECT_RATIOS = new Set<VipVideoRequest["aspect_ratio"]>([
  "21:9", "16:9", "4:3", "1:1", "3:4", "9:16",
]);

export function mapVipModel(model: string): VipVideoRequest["model"] {
  const value = MODEL_MAP[model];
  if (value === undefined) throw new Error(`VIP does not expose a Seedance 2 route for ${model}`);
  return value;
}

export function mapVipResolution(value: string): VipVideoRequest["resolution"] {
  const result = RESOLUTION_MAP[value];
  if (result === undefined) throw new Error(`VIP Seedance 2 does not support resolution ${value}`);
  return result;
}

export type VipVideoInput = {
  model: string;
  prompt: string;
  duration: number;
  resolution?: string;
  aspectRatio?: string;
  refs?: readonly VipReference[];
  generateAudio?: boolean;
  webSearch?: boolean;
};

export function validateVipVideoShape(input: Omit<VipVideoInput, "prompt" | "refs"> & {
  refs?: readonly Pick<VipReference, "type" | "role">[];
}): void {
  const model = mapVipModel(input.model);
  const is25 = model === "seedance-2-5";
  const maxDuration = is25 ? 30 : 15;
  if (!Number.isSafeInteger(input.duration) || input.duration < 4 || input.duration > maxDuration) {
    throw new Error(`VIP Seedance ${is25 ? "2.5" : "2"} duration must be an integer from 4 to ${maxDuration} seconds`);
  }
  if (input.generateAudio === true) throw new Error("VIP Seedance 2 does not declare generateAudio support");
  if (input.webSearch === true) throw new Error("VIP Seedance 2 does not declare webSearch support");
  const resolution = mapVipResolution(input.resolution ?? "720p");
  if (is25 && resolution === "4K") throw new Error("VIP Seedance 2.5 does not support resolution 4K");
  const aspectRatio = input.aspectRatio ?? "9:16";
  if (!ASPECT_RATIOS.has(aspectRatio as VipVideoRequest["aspect_ratio"])) {
    throw new Error(`VIP Seedance 2 does not support aspect ratio ${aspectRatio}`);
  }
  const refs = input.refs === undefined ? [] : [...input.refs];
  if (is25) {
    for (const [type, limit] of [["image", 30], ["video", 10], ["audio", 10]] as const) {
      if (refs.filter((ref) => ref.type === type && ref.role !== "first_frame" && ref.role !== "last_frame").length > limit) {
        throw new Error(`VIP Seedance 2.5 accepts at most ${limit} ${type} references`);
      }
    }
    if (refs.length > 50) throw new Error("VIP Seedance 2.5 accepts at most 50 references");
  } else if (refs.length > 15) {
    throw new Error("VIP Seedance 2 accepts at most 15 references");
  }
  const first = refs.filter((ref) => ref.role === "first_frame");
  const last = refs.filter((ref) => ref.role === "last_frame");
  const frameMode = first.length > 0 || last.length > 0;
  if (first.length > 1 || last.length > 1) throw new Error("VIP accepts at most one first_frame and one last_frame");
  if (last.length > 0 && first.length === 0) throw new Error("VIP last_frame requires first_frame");
  if (frameMode && refs.some((ref) => ref.role !== "first_frame" && ref.role !== "last_frame")) {
    throw new Error("VIP strict frame references cannot mix with ordinary references");
  }
  if (!is25 && !frameMode && refs.length > 0 && !refs.some((ref) => ref.type === "image" || ref.type === "video")) {
    throw new Error("VIP ordinary references require at least one image or video");
  }
  for (const ref of refs) {
    const expectedRole = { image: "reference_image", video: "reference_video", audio: "reference_audio" }[ref.type];
    if (expectedRole === undefined) throw new Error(`VIP reference type ${ref.type} is unsupported`);
    if (ref.role === "first_frame" || ref.role === "last_frame") {
      if (ref.type !== "image") throw new Error("VIP frame references must use type=image");
    } else if (ref.role !== undefined && ref.role !== expectedRole) {
      throw new Error(`VIP reference role ${ref.role} does not match type=${ref.type}`);
    }
  }
}

export function buildVipVideoRequest(input: VipVideoInput): VipVideoRequest {
  if (typeof input.prompt !== "string" || input.prompt.length === 0) throw new Error("VIP video prompt is required");
  validateVipVideoShape(input);
  const refs = input.refs === undefined ? [] : [...input.refs];
  for (const ref of refs) {
    if (!/^https:\/\//u.test(ref.url)) throw new Error("VIP references must be public HTTPS URLs");
  }
  const request: VipVideoRequest = {
    model: mapVipModel(input.model),
    prompt: input.prompt,
    duration: input.duration,
    resolution: mapVipResolution(input.resolution ?? "720p"),
    aspect_ratio: (input.aspectRatio ?? "9:16") as VipVideoRequest["aspect_ratio"],
  };
  if (refs.length > 0) request.ref = refs;
  return request;
}

export type VipTaskStatus = "queued" | "pending" | "processing" | "in_progress" | "completed" | "failed" | "cancelled";
export type HypitPollStatus = "pending" | "ready" | "failed";

export function mapVipTaskStatus(status: string): HypitPollStatus {
  if (status === "queued" || status === "pending" || status === "processing" || status === "in_progress") return "pending";
  if (status === "completed") return "ready";
  if (status === "failed" || status === "cancelled") return "failed";
  throw new Error(`Unknown VIP video task status: ${status}`);
}

export function extractVipResultUrl(task: unknown): string {
  if (task === null || typeof task !== "object" || Array.isArray(task)) throw new Error("VIP task response is not an object");
  const metadata = (task as { metadata?: unknown }).metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("VIP completed task has no metadata");
  const url = (metadata as { url?: unknown }).url;
  if (typeof url !== "string" || !/^https:\/\//u.test(url)) throw new Error("VIP completed task has no usable metadata.url");
  return url;
}
