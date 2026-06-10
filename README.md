# vending-identity-service

> **人脸识别参考服务**（Cloudflare Worker）—— 为 [`commerce-harness`](https://github.com/fxp/commerce-harness)
> 的 `identity` 适配器提供 **1:N 人脸识别 + 活体 + 特征向量登记**。属"外部系统各自独立成 repo"范式
> （与 `ucp-vending-machine`、`vending-supply-chain`、`vending-payment-sandbox`、`vending-welfare-service` 并列）。

## 关键架构边界：生物私钥不离设备
本服务**只做识别**（face_token → user_id + 活体）。AP2 Intent Mandate 的**生物签名仍在设备本地完成**
（harness `IdentityHTTPAdapter.sign_intent`，安全隔区派生密钥），**私钥永不上送**——故本服务**无签名端点**。
这与真实硬件一致：相机/边缘设备识别走服务，签名走设备安全隔区。

## API（基址 `/identity/v1`）

| 端点 | 行为 | 返回 |
|---|---|---|
| `POST /verify` `{face_token}` | 1:N 识别 + 活体 | `{ identity:{user_id,verified,liveness,method:"face"} }` ｜ `404 {error:"face_not_recognized"}` |
| `POST /enroll` `{user_id,face_token,feature_vector}` | 登记特征 | `{enrolled}` ｜ `422`（**INV-8**：含 `image/photo/raw…` 原始图像字段 → 拒绝；只存特征向量）|
| `GET /users/{id}` | 是否已登记 | `{user_id, enrolled}` |
| `POST /liveness` `{face_token,challenge}` | 活体挑战 | `{passed, challenge}` |
| `POST /_reset` | 重置种子 | `{ok, reseeded}` |
| `GET /health` | 健康检查 | `{ok, enrolled}` |

**种子**：`face_u_1001`→`u_1001`、`face_u_1002`→`u_1002`（与 harness 对齐）。

## 运行 / 部署 / 测试
```bash
npm install
npm test                    # 复刻 harness identity 契约的可外部化部分（verify/活体/INV-8 登记）
npm run dev                 # http://localhost:8787
npm run deploy              # 部署到 <account>.workers.dev（需 wrangler 已登录 Cloudflare）
```

## 联调 commerce-harness
```bash
export IDENTITY_URL="https://vending-identity-service.<account>.workers.dev"
cd <commerce-harness> && python -m pytest tests/contracts/test_identity_contract.py -q
# 适配器 verify 走本服务；sign_intent 在本地（生物私钥不上送）。无 IDENTITY_URL 时 http 用例 skip。
```

## 设计取舍
- **INV-8（只存特征向量）**：`enroll` 拒绝任何原始图像字段（`image/photo/raw/...`），生产 D1 表同样只存特征向量。
- **活体**：沙箱恒过；真实接厂商 challenge-response 防重放。
- **状态进程内 + `_reset`**：契约可复现；生产换真实人脸厂商时端点形状不变，harness 适配器不改。

## 谱系
`commerce-harness` 的外部系统之一。同族：`ucp-vending-machine` · `vending-supply-chain` ·
`vending-payment-sandbox` · `vending-welfare-service` · **vending-identity-service（本仓库）**。
