import test from "node:test";
import assert from "node:assert/strict";
import { register } from "../packages/provider-vip-brioi/node_modules/tsx/dist/esm/api/index.mjs";

register();
const distributionRoot = new URL("../packages/provider-vip-brioi/node_modules/@hypit/hypit/", import.meta.url).pathname;
const { installDistributionPackageResolution } = await import(
  "../packages/provider-vip-brioi/node_modules/@hypit/hypit/packages/package-loader-node/src/distribution-resolution.ts"
);
installDistributionPackageResolution([distributionRoot]);
const { createVipVideoProvider } = await import("../packages/provider-vip-brioi/dist/provider.js");

test("Seedance 2.5 offer submits, checkpoints, polls and collects via VIP", async () => {
  const calls = [];
  const media = new Uint8Array([0, 0, 0, 24]);
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/videos") && init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), {
        model: "seedance-2-5", prompt: "A scene", duration: 30,
        resolution: "1080p", aspect_ratio: "16:9",
      });
      return Response.json({ task_id: "task_25", status: "queued" });
    }
    if (url.endsWith("/v1/videos/task_25")) {
      const polls = calls.filter((call) => call.url.endsWith("/v1/videos/task_25")).length;
      return Response.json(polls === 1 ? { status: "processing" } : {
        status: "completed", metadata: { url: "https://media.example.com/result.mp4" },
      });
    }
    if (url === "https://media.example.com/result.mp4") {
      assert.equal(init.headers?.authorization, undefined);
      return new Response(media, { headers: { "content-type": "video/mp4" } });
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  const provider = createVipVideoProvider({
    instance: "vip-brioi.video", pool: "test", baseUrl: "https://vip.brioi.com",
    apiKey: { store: "platform", key: "test" }, fetch: fetcher,
  });
  const offer = provider.offers.find((item) => item.capability.name === "seedance-2.5");
  assert.ok(offer);
  const ports = { prompt: ["A scene"], duration: [30], resolution: ["1080p"], aspectRatio: ["16:9"] };
  const request = { capability: offer.capability, returns: offer.returns, constraints: { ports } };
  assert.equal(offer.supports(request).status, "supported");
  assert.equal(offer.supports({ ...request, constraints: { ports: { ...ports, duration: [-1] } } }).status, "unsupported");
  let endpoint;
  provider.install({
    registerAsyncEndpoint(_instance, capability, _returns, handler) {
      if (capability.name === "seedance-2.5") endpoint = handler;
    },
  });
  assert.ok(endpoint);
  const checkpoints = [];
  const context = {
    need: request, credentials: { apiKey: { secret: "test-secret" } },
    resources: {
      async put(bytes, mediaType) {
        assert.deepEqual(bytes, media);
        assert.equal(mediaType, "video/mp4");
        return { kind: "blob", resource: "res_result-video", size: bytes.length, mediaType };
      },
    },
    async checkpoint(value) { checkpoints.push(value); },
  };
  const started = await endpoint.start(context);
  assert.equal(started.status, "pending");
  assert.deepEqual(checkpoints, [{ handle: { id: "task_25" }, receipt: { id: "task_25" } }]);
  const pending = await endpoint.poll({ ...context, handle: started.handle });
  assert.equal(pending.status, "pending");
  const ready = await endpoint.poll({ ...context, handle: pending.handle });
  assert.equal(ready.status, "ready");
  const completed = await endpoint.collect({ ...context, handle: ready.handle });
  assert.equal(completed.status, "completed");
  assert.equal(calls.length, 4);
});
