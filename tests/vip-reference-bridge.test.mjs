import test from "node:test";
import assert from "node:assert/strict";
import { compileVipVideoRequest } from "../packages/provider-vip-brioi/dist/vip-reference-bridge.js";

function media(resource, mediaType, role = "image") {
  return { role, artifact: { kind: "blob", resource, size: 4, mediaType } };
}

function request(ports) {
  return { ports: { prompt: ["Keep the reference details"], duration: [5], resolution: ["720p"], aspectRatio: ["16:9"], ...ports } };
}

test("uploads local references once per content and keeps reference order and roles", async () => {
  const bytes = {
    imageA: new Uint8Array([1, 2, 3]),
    imageB: new Uint8Array([1, 2, 3]),
    video: new Uint8Array([4, 5]),
    audio: new Uint8Array([6, 7]),
  };
  const resources = {
    async get(id) {
      return bytes[id];
    },
  };
  const uploads = [];
  const uploader = {
    async upload(input) {
      uploads.push(input);
      return { url: `https://d.uguu.se/upload-${uploads.length}` };
    },
  };
  const compiled = await compileVipVideoRequest("seedance-2", request({
    referenceImage: [media("imageA", "image/png"), media("imageB", "image/png")],
    referenceVideo: [media("video", "video/mp4")],
    referenceAudio: [media("audio", "audio/mpeg")],
  }), resources, { uploader });

  assert.equal(uploads.length, 3);
  assert.deepEqual(compiled.ref.map(({ url, type, role }) => ({ url, type, role })), [
    { url: "https://d.uguu.se/upload-1", type: "image", role: "reference_image" },
    { url: "https://d.uguu.se/upload-1", type: "image", role: "reference_image" },
    { url: "https://d.uguu.se/upload-2", type: "video", role: "reference_video" },
    { url: "https://d.uguu.se/upload-3", type: "audio", role: "reference_audio" },
  ]);
  assert.ok(compiled.ref.every(({ url }) => url.startsWith("https://")));
});

test("reuses a valid public HTTPS reference without reading or uploading it", async () => {
  let reads = 0;
  let uploads = 0;
  const fetcher = async (_url, init = {}) => {
    assert.equal(init.method, "HEAD");
    return new Response(null, { status: 200, headers: { "content-type": "image/png" } });
  };
  const compiled = await compileVipVideoRequest("seedance-2", request({
    referenceImage: [media("https://media.example.com/reference.png", "image/png")],
  }), {
    async get() {
      reads += 1;
      return new Uint8Array([1]);
    },
  }, {
    fetch: fetcher,
    uploader: { async upload() { uploads += 1; return { url: "https://d.uguu.se/unused" }; } },
  });

  assert.equal(reads, 0);
  assert.equal(uploads, 0);
  assert.deepEqual(compiled.ref, [{ url: "https://media.example.com/reference.png", type: "image", role: "reference_image" }]);
});

test("keeps strict first-frame and last-frame roles after upload", async () => {
  const uploaded = [];
  const compiled = await compileVipVideoRequest("seedance-2", request({
    firstFrame: [media("first", "image/png")],
    lastFrame: [media("last", "image/png")],
  }), {
    async get(id) { return new Uint8Array(id === "first" ? [1] : [2]); },
  }, {
    uploader: { async upload() { const url = `https://d.uguu.se/frame-${uploaded.length}`; uploaded.push(url); return { url }; } },
  });

  assert.deepEqual(compiled.ref.map(({ url, role }) => ({ url, role })), [
    { url: "https://d.uguu.se/frame-0", role: "first_frame" },
    { url: "https://d.uguu.se/frame-1", role: "last_frame" },
  ]);
});

test("stops before any VIP submission when a local upload fails", async () => {
  let vipPosts = 0;
  await assert.rejects(
    compileVipVideoRequest("seedance-2", request({ referenceImage: [media("broken", "image/png")] }), {
      async get() { return new Uint8Array([1, 2]); },
    }, {
      uploader: { async upload() { throw new Error("Uguu unavailable"); } },
    }),
    /Uguu unavailable/,
  );
  assert.equal(vipPosts, 0);
});
