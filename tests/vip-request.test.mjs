import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVipVideoRequest,
  extractVipResultUrl,
  mapVipModel,
  mapVipResolution,
  mapVipTaskStatus,
} from "../packages/provider-vip-brioi/src/vip-request.ts";

test("maps a text-to-video request to the VIP contract", () => {
  assert.deepEqual(buildVipVideoRequest({
    model: "seedance-2-mini",
    prompt: "A paper boat drifting through a rainy neon city",
    duration: 5,
    resolution: "720p",
    aspectRatio: "16:9",
  }), {
    model: "seedance-2-0-mini",
    prompt: "A paper boat drifting through a rainy neon city",
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
  });
});

test("maps model and 4K spelling", () => {
  assert.equal(mapVipModel("seedance-2"), "seedance-2-0");
  assert.equal(mapVipModel("seedance-2-fast"), "seedance-2-0-fast");
  assert.equal(mapVipResolution("4k"), "4K");
});

test("preserves ordinary reference roles and strict frame roles", () => {
  const ordinary = buildVipVideoRequest({
    model: "seedance-2",
    prompt: "Use @图片1 and @视频1 as references",
    duration: 8,
    refs: [
      { url: "https://media.example.com/person.png", type: "image", role: "reference_image" },
      { url: "https://media.example.com/motion.mp4", type: "video", role: "reference_video" },
    ],
  });
  assert.equal(ordinary.ref?.length, 2);
  const frames = buildVipVideoRequest({
    model: "seedance-2",
    prompt: "Transition from morning to night",
    duration: 8,
    refs: [
      { url: "https://media.example.com/morning.png", type: "image", role: "first_frame" },
      { url: "https://media.example.com/night.png", type: "image", role: "last_frame" },
    ],
  });
  assert.equal(frames.ref?.[0]?.role, "first_frame");
  assert.equal(frames.ref?.[1]?.role, "last_frame");
});

test("rejects unsupported options and invalid reference combinations", () => {
  assert.throws(() => buildVipVideoRequest({ model: "seedance-2", prompt: "x", duration: 5, generateAudio: true }), /generateAudio/);
  assert.throws(() => buildVipVideoRequest({ model: "seedance-2", prompt: "x", duration: 5, aspectRatio: "adaptive" }), /aspect ratio/);
  assert.throws(() => buildVipVideoRequest({ model: "seedance-2", prompt: "x", duration: 5, refs: [{ url: "https://x.test/a.mp3", type: "audio" }] }), /image or video/);
  assert.throws(() => buildVipVideoRequest({ model: "seedance-2", prompt: "x", duration: 5, refs: [
    { url: "https://x.test/a.png", type: "image", role: "first_frame" },
    { url: "https://x.test/b.png", type: "image", role: "last_frame" },
    { url: "https://x.test/c.png", type: "image", role: "reference_image" },
  ] }), /cannot mix/);
});

test("normalizes VIP task states and requires a completed result URL", () => {
  assert.equal(mapVipTaskStatus("queued"), "pending");
  assert.equal(mapVipTaskStatus("in_progress"), "pending");
  assert.equal(mapVipTaskStatus("completed"), "ready");
  assert.equal(mapVipTaskStatus("failed"), "failed");
  assert.equal(extractVipResultUrl({ metadata: { url: "https://media.example.com/result.mp4" } }), "https://media.example.com/result.mp4");
  assert.throws(() => extractVipResultUrl({ metadata: {} }), /metadata\.url/);
});

