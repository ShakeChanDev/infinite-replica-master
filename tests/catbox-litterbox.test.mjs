import test from "node:test";
import assert from "node:assert/strict";
import {
  LITTERBOX_ENDPOINT,
  LITTERBOX_RETENTION,
  createLitterboxUploader,
} from "../packages/provider-vip-brioi/src/catbox-litterbox.ts";

function mockLitterboxFetch({ uploadBody = "https://litter.catbox.moe/example.bin", contentType = "image/png", headStatus = 200 } = {}) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === LITTERBOX_ENDPOINT) return new Response(uploadBody, { status: 200 });
    if (init.method === "HEAD") return new Response(null, { status: headStatus, headers: { "content-type": contentType } });
    return new Response(new Uint8Array([0]), { status: 206, headers: { "content-type": contentType } });
  };
  return { calls, fetcher };
}

test("uploads multipart data with the fixed 72h retention and verifies the direct URL", async () => {
  const { calls, fetcher } = mockLitterboxFetch();
  const result = await createLitterboxUploader({ fetch: fetcher, maxAttempts: 1 }).upload({
    bytes: new Uint8Array([137, 80, 78, 71]),
    mediaType: "image/png",
  });

  assert.deepEqual(result, { url: "https://litter.catbox.moe/example.bin", retention: LITTERBOX_RETENTION });
  const upload = calls[0];
  assert.equal(upload.url, LITTERBOX_ENDPOINT);
  assert.equal(upload.init.method, "POST");
  assert.ok(upload.init.body instanceof FormData);
  assert.equal(upload.init.body.get("reqtype"), "fileupload");
  assert.equal(upload.init.body.get("time"), "72h");
  const file = upload.init.body.get("fileToUpload");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "image/png");
  assert.match(file.name, /^input-[^.]+\.png$/u);
  assert.equal(calls[1].init.method, "HEAD");
});

test("falls back to a one-byte range request when HEAD is unsupported", async () => {
  const { calls, fetcher } = mockLitterboxFetch({ headStatus: 405, contentType: "video/mp4" });
  await createLitterboxUploader({ fetch: fetcher, maxAttempts: 1 }).upload({
    bytes: new Uint8Array([0, 1, 2]),
    mediaType: "video/mp4",
  });
  assert.equal(calls[2].init.headers.range, "bytes=0-0");
  assert.equal(calls[2].init.method, undefined);
});

test("preserves image, video, and audio MIME types in the multipart file", async () => {
  for (const mediaType of ["image/png", "video/mp4", "audio/mpeg"]) {
    const { calls, fetcher } = mockLitterboxFetch({ contentType: mediaType });
    await createLitterboxUploader({ fetch: fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType });
    assert.equal(calls[0].init.body.get("fileToUpload").type, mediaType);
  }
});

test("rejects non-HTTPS, HTML, and mismatched-MIME responses", async () => {
  const nonHttps = mockLitterboxFetch({ uploadBody: "http://litter.catbox.moe/example.png" });
  await assert.rejects(
    createLitterboxUploader({ fetch: nonHttps.fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType: "image/png" }),
    /non-public media URL/,
  );

  const html = mockLitterboxFetch({ uploadBody: "<html>temporary error</html>" });
  await assert.rejects(
    createLitterboxUploader({ fetch: html.fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType: "image/png" }),
    /invalid URL/,
  );

  const wrongMime = mockLitterboxFetch({ contentType: "text/html" });
  await assert.rejects(
    createLitterboxUploader({ fetch: wrongMime.fetcher, maxAttempts: 1 }).upload({ bytes: new Uint8Array([1]), mediaType: "image/png" }),
    /MIME type text\/html does not match image\/png/,
  );
});
