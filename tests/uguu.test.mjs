import test from "node:test";
import assert from "node:assert/strict";
import {
  UGUU_ENDPOINT,
  UGUU_MAX_BYTES,
  createUguuUploader,
} from "../packages/provider-vip-brioi/src/uguu.ts";

function mockUguuFetch({ body, contentType = "image/png", headStatus = 200, headLength = "4" } = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === UGUU_ENDPOINT) return new Response(body ?? JSON.stringify({ success: true, files: [{ url: "https://d.uguu.se/example.png" }] }), { status: 200 });
    if (init.method === "HEAD") return new Response(null, { status: headStatus, headers: { "content-type": contentType, "content-length": headLength } });
    return new Response(new Uint8Array([0]), { status: 206, headers: { "content-type": contentType, "content-length": "1" } });
  };
  return { calls, fetcher };
}

test("uploads multipart data and verifies Uguu's direct URL", async () => {
  const { calls, fetcher } = mockUguuFetch();
  const result = await createUguuUploader({ fetch: fetcher, maxAttempts: 1 }).upload({
    bytes: new Uint8Array([137, 80, 78, 71]),
    mediaType: "image/png",
  });

  assert.deepEqual(result, { url: "https://d.uguu.se/example.png" });
  const upload = calls[0];
  assert.equal(upload.url, UGUU_ENDPOINT);
  assert.equal(upload.init.method, "POST");
  assert.ok(upload.init.body instanceof FormData);
  const file = upload.init.body.get("files[]");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "image/png");
  assert.match(file.name, /^input-[^.]+\.png$/u);
  assert.equal(calls[1].init.method, "HEAD");
});

test("falls back to a one-byte range request when HEAD is unsupported", async () => {
  const { calls, fetcher } = mockUguuFetch({ headStatus: 405, contentType: "video/mp4", headLength: "5188" });
  await createUguuUploader({ fetch: fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([0, 1, 2]), mediaType: "video/mp4" });
  assert.equal(calls[2].init.headers.range, "bytes=0-0");
});

test("preserves image, video, and audio MIME types", async () => {
  for (const mediaType of ["image/png", "video/mp4", "audio/mpeg"]) {
    const { calls, fetcher } = mockUguuFetch({ contentType: mediaType });
    await createUguuUploader({ fetch: fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType });
    assert.equal(calls[0].init.body.get("files[]").type, mediaType);
  }
});

test("rejects non-Uguu URLs, HTML/error JSON, mismatched MIME, and oversized files", async () => {
  const nonHttps = mockUguuFetch({ body: JSON.stringify({ success: true, files: [{ url: "http://d.uguu.se/example.png" }] }) });
  await assert.rejects(createUguuUploader({ fetch: nonHttps.fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType: "image/png" }), /non-public media URL/);

  const html = mockUguuFetch({ body: "<html>temporary error</html>" });
  await assert.rejects(createUguuUploader({ fetch: html.fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType: "image/png" }), /invalid JSON/);

  const wrongMime = mockUguuFetch({ contentType: "text/html" });
  await assert.rejects(createUguuUploader({ fetch: wrongMime.fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType: "image/png" }), /MIME type text\/html does not match image\/png/);

  const oversized = new Uint8Array(UGUU_MAX_BYTES + 1);
  await assert.rejects(createUguuUploader({ fetch: async () => { throw new Error("must not upload"); }, maxAttempts: 1 }).upload({ bytes: oversized, mediaType: "video/mp4" }), /128 MiB file limit/);
});
