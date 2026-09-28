# 无限复刻大师

这个仓库提供一个可独立调用的 **hypitPro Skill** 和 Hypit VIP Provider。hypitPro 从[官方 Hypit Skill](https://github.com/hypit-ai/hypit/tree/main/skills/hypit)完整派生，保留它的创作流程与参考资料，只把已支持的 Seedance 视频请求明确绑定到 `https://vip.brioi.com/v1/videos`。Hypit CLI、Model、SVML/SVS/SVRun 格式仍然属于官方发行版。

```text
hypitPro Skill ($hypit-pro)
  -> Hypit Seedance Model
  -> @infinite-replica/provider-vip-brioi
  -> VIP POST /v1/videos
  -> VIP GET /v1/videos/{task_id}
```

## 设计边界

- [`hypitPro Skill`](.agents/skills/hypit-pro/SKILL.md) 保留官方 Skill 的完整制作指令及随附参考资料，在服务选择处明确要求 VIP 视频路由。显示名是 `hypitPro`；Codex 调用标识按命名规范写作 `$hypit-pro`。
- 本项目的 Provider 负责 VIP 请求映射、异步轮询、结果下载和 Runtime Profile，不修改 Hypit 本体或官方全局安装的 `$hypit`。
- 派生来源、上游提交与许可记录在 [`upstream/hypit-skill.json`](upstream/hypit-skill.json) 和 [Skill LICENSE](.agents/skills/hypit-pro/LICENSE)。更新上游时先审阅差异，再同步完整参考资料并保留本项目的路由规则。
- VIP Profile 绑定 Seedance 2、Seedance 2 Fast、Seedance 2 Mini 和 Seedance 2.5。图片、语音等能力尚无 VIP 适配；Skill 必须在执行付费请求前明确提示，而不是自动改走其他服务。

这遵循 Hypit 原始 Skill 的职责划分：Skill 负责创作流程，Model 负责请求语义，Provider 负责把请求转换成服务的 HTTP 合同。

## 安装与配置

要求 Node.js 22.15+、npm 或 pnpm、Hypit CLI，以及一个可访问的 VIP API Key。先构建 Provider：

```bash
npm ci
npm --prefix packages/provider-vip-brioi ci
npm run build
```

把 Provider 接入一个 Hypit 视频项目：

```bash
npm run setup:hypit-vip -- --workspace /path/to/hypit-video-project
```

这个命令会：

1. 从本仓库安装 `hypitPro` Skill，不更改官方 `hypit` Skill；
2. 把本地 Provider 安装到指定 Hypit 项目；
3. 生成 `hypit.runtime.vip.json`，并保留项目已有的其他 Profile 配置。

只需安装 Skill 时执行 `npm run install:hypit-pro`；接入脚本不安装 Skill 时可加 `--skip-skill`。脚本不会读取或写入 API Key。

选择 Profile 并登记凭据：

```bash
hypit runtime use /path/to/hypit-video-project/hypit.runtime.vip.json \
  --workspace /path/to/hypit-video-project
hypit auth login vip-brioi.video --workspace /path/to/hypit-video-project
```

`auth login` 会把 Key 写入 Hypit 的凭据存储；Runtime Profile 只保存凭据引用：

```json
{
  "store": "platform",
  "key": "vip-brioi.personal"
}
```

## 使用 hypitPro Skill

在已选择 VIP Profile 的 Hypit 视频项目目录中启动 Codex，然后调用：

```text
$hypit-pro 请复刻 /path/to/video.mp4，更换出镜人物，但先与我确认产品和动作中哪些必须保留。确认后再按 VIP 绑定准备视频生成。
```

Skill 名称不修改 Hypit 的 CLI、Logo 或生成报告。调用 `$hypit-pro` 不会自动选择配置文件或登记凭据；务必用 `hypit paths` 确认当前项目实际选中了 VIP Profile，然后用 `hypit plan` 核对本次 Run 的所有视频 Need 都绑定 VIP。

## Runtime Profile

完整模板见 [`hypit.runtime.example.json`](hypit.runtime.example.json)。关键 binding 是：

```json
{
  "endpoints": {
    "vip-brioi.video": {
      "use": "@infinite-replica/provider-vip-brioi",
      "config": {
        "baseUrl": "https://vip.brioi.com",
        "apiKey": { "store": "platform", "key": "vip-brioi.personal" },
        "concurrency": 1,
        "pollIntervalMs": 5000,
        "personReferencePolicy": "advisory"
      }
    }
  },
  "bindings": {
    "@hypit/seedance@1#seedance-2": "vip-brioi.video",
    "@hypit/seedance@1#seedance-2-fast": "vip-brioi.video",
    "@hypit/seedance@1#seedance-2-mini": "vip-brioi.video",
    "@hypit/seedance@1#seedance-2.5": "vip-brioi.video"
  }
}
```

`personReference` 是官方 Seedance Model 的输入字段，但当前 VIP `ref[]` 合同没有声明对应的 wire 字段。默认 Provider 会拒绝它，防止静默丢语义；模板显式使用 `advisory`，表示允许继续请求，但 VIP 只会收到媒体 URL、类型和角色，不能承诺人物身份锁定。需要严格人物分类时，应使用声明该能力的 Provider，并把策略改成 `reject`。

本地或私有参考素材会先上传到 Uguu，随后以无需登录的 HTTPS URL 发送给 VIP；合格的公网 HTTPS URL 会直接复用。上传不保存 VIP Key，当前公开文件上限为 128 MiB。

## 当前支持范围

- Seedance 2、Seedance 2 Fast、Seedance 2 Mini（4 到 15 秒），以及 Seedance 2.5（4 到 30 秒）；
- 2.5 映射为 VIP `seedance-2-5`，支持 480p/720p/1080p、六种固定宽高比、纯音频参考及最多 30 图/10 视频/10 音频；不支持自动时长 `-1` 或 4K；
- VIP Provider 实际支持的分辨率和宽高比；
- 图片、视频、音频、首帧和尾帧参考的顺序与角色转换；
- VIP 异步创建、原任务轮询、成功结果下载和 Hypit Resource Store 回写。

当前不包含图片 Provider、WhisperX、其他音频 Provider，也不会为了验证安装而发起真实付费生成。
2.5 的视频参考在 VIP 文档中有已知上游摄取问题，音频参考和严格帧尚未完成真实生成验收；本项目的本地测试只证明请求映射和生命周期逻辑。

## 验证

```bash
npm test
```

测试只使用本地 mock，验证请求编译、参考素材桥接、VIP 状态转换、结果 URL 提取和负向边界，不读取生产 Key、不访问 VIP，也不创建真实任务。
