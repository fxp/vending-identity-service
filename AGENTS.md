# AGENTS.md — vending-identity-service

> 人脸识别参考服务（Cloudflare Worker）。Project Vend 生态的外部服务之一——"外部系统各自独立成 repo，
> harness 只写适配器"。本文件供**独立开发本 repo 的 Agent** 上手；完整 API/seed 见 [README.md](README.md)。

## 角色定位
- harness 的 `identity` 能力 = `IdentityHTTPAdapter`，通过 `IDENTITY_URL` 指向本服务。
- 提供：**1:N 人脸识别 + 活体 + 特征向量登记**。
- ⚠️ **关键边界：只做识别，不做签名**。AP2 Intent Mandate 的生物签名在**设备本地安全隔区**完成（harness `IdentityHTTPAdapter.sign_intent`），**生物私钥永不上送**——故本服务**没有签名端点**。

## 技术栈 / 绑定
- TS + Cloudflare Worker，单文件 `src/index.ts`，配置 `wrangler.toml`。
- **无外部绑定**：状态进程内 Map（含 `_reset`）。
- 种子：`face_u_1001`→`u_1001`、`face_u_1002`→`u_1002`。

## 开发 / 测试 / 部署
```bash
npm install
npm test          # verify / 活体 / INV-8 登记 的冒烟
npm run dev       # http://localhost:8787
npm run deploy    # 需 wrangler 已登录
```

## CI/CD（GitHub Actions，`.github/workflows/ci.yml`）
- push `main` → typecheck → deploy（wrangler）→ curl `/health` 冒烟；PR 只 typecheck。
- secret **`CLOUDFLARE_API_TOKEN`**（Workers Scripts + KV + D1 Edit）；`wrangler.toml` 无 account_id → workflow 显式给 `CLOUDFLARE_ACCOUNT_ID`。缺 token 守卫优雅跳过。

## 不可破坏的契约（harness 依赖）
- `GET /health` 返回含 `{"ok":true}`（CI 冒烟 + 看板断言）。
- **INV-8（铁律）**：`POST /enroll` 收到含 `image/photo/raw…` 等**原始图像字段必须拒绝（422）**，只接受/存储**特征向量**。这是隐私底线，改 enroll 逻辑前务必保留。
- `POST /verify` 返回 `{identity:{user_id,verified,liveness,method:"face"}}`，未识别 → `404 face_not_recognized`，匹配 harness 适配器解析。

## 已知坑 / 约定
- 别加任何"签名/私钥"端点——架构上签名属设备侧，加了就破坏信任边界。
- 进程内状态仅供联调/CI；生产持久化特征向量绑 D1（**绝不存原始图像**，INV-8）。

## 关系
同族外部服务：`ucp-vending-machine` · `vending-supply-chain` · `vending-payment-sandbox` · `vending-welfare-service` · `vending-notify-gateway`。监控看板：`vending-status-dashboard`。
