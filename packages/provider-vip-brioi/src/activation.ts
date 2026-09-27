import {
  createRuntimeEndpointAdapterFacet, runtimeConfigCredentialRef, runtimeConfigExact,
  runtimeConfigObject, runtimeConfigPositiveInteger, runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createVipVideoProvider, providerModule } from "./provider.js";

export default {
  format: "hypit.node-package@1" as const,
  hostFacets: [createRuntimeEndpointAdapterFacet({
    use: providerModule.name,
    activate(context) {
      const config = runtimeConfigObject(context.config, "VIP Brioi video service");
      runtimeConfigExact(config, ["baseUrl", "apiKey", "concurrency", "pollIntervalMs"], "VIP Brioi video service");
      const baseUrl = runtimeConfigString(config.baseUrl, "VIP Brioi baseUrl");
      const apiKey = runtimeConfigCredentialRef(config.apiKey, "VIP Brioi apiKey");
      if (!baseUrl || !apiKey || !context.pool) throw new Error("VIP Brioi requires baseUrl, apiKey and pool");
      return { endpoint: createVipVideoProvider({
        instance: context.instance,
        pool: context.pool,
        baseUrl,
        apiKey,
        concurrency: runtimeConfigPositiveInteger(config.concurrency, "concurrency") ?? 1,
        pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "pollIntervalMs") ?? 5_000,
      }) };
    },
  })],
};

