# 无限复刻大师

基于 [Hypit](https://github.com/hypit-ai/hypit) 的视频复刻项目，将 Hypit 的 Seedance 生成 Provider 接到 API-Map 的 VIP 接口：

```text
Hypit Model → VIP Provider → https://vip.brioi.com/v1/videos
```

项目当前只实现安全的第一阶段：

- Seedance 2 / Fast / Mini 的视频 Provider 骨架；
- VIP `POST /v1/videos` 异步提交；
- VIP `GET /v1/videos/{id}` 状态轮询；
- 完成后下载 `metadata.url` 并交回 Hypit 资源仓库；
- 模型名、分辨率、宽高比和任务状态转换；
- 本地或私有参考素材自动上传到 Uguu；
- 本地 mock dry-run 与负向边界测试。

当前不包含：

- 真实 VIP API Key；
- 真实付费生成请求；
- 图片 Provider、WhisperX 或其他音频 Provider。

## 为什么是 Provider，而不是修改 Skill

Hypit 的 Skill 负责创作流程和生产知识，Model 负责定义输入，Provider 负责把请求转换成某个服务的 HTTP 合同。这样可以保留 Hypit 的创作入口，同时把实际生成路由绑定到 VIP Endpoint。

## 安装

要求 Node.js 22.15+、npm 或 pnpm，以及一个已安装的 `@hypit/hypit` 发行版。Provider 包位于：

```text
packages/provider-vip-brioi/
```

安装依赖并构建：

```bash
npm install
npm run build
```

Provider 依赖 `@hypit/hypit` 的公开 `endpoint-kit`、`generation` 和 `runtime-kit` 接口。第一次使用时，请使用与你当前 Hypit Distribution 相同的版本，不要把不同版本的 SDK 混用。

## Runtime Profile 示例

复制 `hypit.runtime.example.json` 为项目自己的 Runtime Profile，再通过 Hypit 的凭据存储登记 VIP API Key。示例只保存凭据引用，不保存 Key 本身：

```json
{
  "endpoints": {
    "vip-brioi.video": {
      "use": "@infinite-replica/provider-vip-brioi",
      "config": {
        "baseUrl": "https://vip.brioi.com",
        "apiKey": { "store": "platform", "key": "vip-brioi.personal" }
      }
    }
  },
  "bindings": {
    "@hypit/seedance@1#seedance-2-mini": "vip-brioi.video"
  }
}
```

## 当前兼容边界

VIP Seedance 2 的公开合同要求参考素材是无需登录即可读取的公网 HTTPS 直链。项目不会把本地文件路径、Cookie 或 API Key 塞进 `ref`。

为保持用户无感，Provider 会自动把本地或私有资源上传到 [Uguu](https://uguu.se/)，然后只把经过预检的 `https://*.uguu.se/...` 直链写入 VIP 请求。用户不需要配置 Uguu、API Key、R2 或手动复制 URL；已经合格的公网 HTTPS 资源会直接复用。Uguu 当前公开上限为 **128 MiB**。

Hypit 的通用 Seedance Model 还暴露 `generateAudio`、`webSearch` 和 `personReference` 等 Provider 可能需要的字段；VIP Seedance 2 页面没有声明这些字段。因此 Provider 对这些未证明可转换的输入保持拒绝，不会静默丢字段。完整参考素材能力需要一个与 VIP 合同严格对应的 Model/Surface 扩展。

## 测试

```bash
npm test
```

测试只验证请求编译、状态转换、结果 URL 提取和负向边界，不访问 VIP、不读取生产 Key，也不创建真实任务。

## 许可证与上游归属

本项目只包含面向 VIP 的适配层和项目配置。Hypit 本体、SDK、Skill 及其许可证仍归 [hypit-ai/hypit](https://github.com/hypit-ai/hypit) 所有；使用时请遵守对应上游许可证和 VIP 服务条款。
