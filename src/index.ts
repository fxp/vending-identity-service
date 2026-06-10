/**
 * vending-identity-service —— 人脸识别参考服务（Cloudflare Worker）
 *
 * 为 commerce-harness 的 identity 适配器提供 **1:N 人脸识别 + 活体 + 特征向量登记**。
 *
 * 关键边界：**生物私钥不离设备**。本服务只做"识别 → user_id"；AP2 Intent 的**生物签名仍在设备
 * 本地完成**（adapter.sign_intent，安全隔区派生密钥），私钥永不上送 —— 故本服务**无签名端点**。
 *
 * 基址 /identity/v1：
 *   POST /verify   { face_token }                          → { identity:{user_id,verified,liveness,method} } | 404
 *   POST /enroll   { user_id, face_token, feature_vector }  → { enrolled }   （INV-8：拒绝原始图像，只存特征向量）
 *   GET  /users/{id}                                        → { user_id, enrolled }
 *   POST /liveness { face_token, challenge }                → { passed, challenge }
 *   POST /_reset
 *
 * 状态进程内（_reset 重置种子）。换真实人脸厂商时端点形状不变（harness 适配器不改）。
 */

interface Enrollment { user_id: string; feature_vector: string; enrolled_at: string; }

const BY_TOKEN = new Map<string, Enrollment>();   // face_token → 特征登记（绝不存原始图像，INV-8）

function seed(): void {
  BY_TOKEN.clear();
  BY_TOKEN.set("face_u_1001", { user_id: "u_1001", feature_vector: "vec:1001", enrolled_at: "seed" });
  BY_TOKEN.set("face_u_1002", { user_id: "u_1002", feature_vector: "vec:1002", enrolled_at: "seed" });
}
seed();

const BASE = "/identity/v1";
const RAW_IMAGE_FIELDS = ["image", "photo", "raw", "image_base64", "frame"];   // INV-8 黑名单

export default {
  async fetch(req: Request): Promise<Response> {
    const p = new URL(req.url).pathname;

    if (p === "/" || p === "/health")
      return json({ ok: true, service: "vending-identity-service", enrolled: BY_TOKEN.size, note: "1:N 识别+活体+特征登记；生物签名在设备本地、私钥不上送。" });

    if (req.method === "POST" && p === `${BASE}/_reset`) { seed(); return json({ ok: true, reseeded: BY_TOKEN.size }); }
    if (req.method === "POST" && p === `${BASE}/verify`) return verify(req);
    if (req.method === "POST" && p === `${BASE}/enroll`) return enroll(req);
    if (req.method === "POST" && p === `${BASE}/liveness`) return liveness(req);

    const m = p.match(/^\/identity\/v1\/users\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const found = [...BY_TOKEN.values()].some((e) => e.user_id === m[1]);
      return json({ user_id: m[1], enrolled: found });
    }

    return json({ error: "not_found", method: req.method, path: p }, 404);
  },
};

async function verify(req: Request): Promise<Response> {
  const b = await safeJson(req);
  const e = BY_TOKEN.get(String(b.face_token ?? ""));
  if (!e) return json({ error: "face_not_recognized", face_token: b.face_token ?? null }, 404);
  // 仅扫脸 = 第二因子（method=face）；活体在沙箱恒过（真实接厂商 liveness）
  return json({ identity: { user_id: e.user_id, verified: true, liveness: true, method: "face" } });
}

async function enroll(req: Request): Promise<Response> {
  const b = await safeJson(req);
  const offending = RAW_IMAGE_FIELDS.filter((f) => f in b);
  if (offending.length) return json({ error: "inv8_raw_image_rejected", fields: offending, detail: "只接受 feature_vector，禁止上送原始图像" }, 422);
  if (!b.user_id || !b.face_token || !b.feature_vector) return json({ error: "missing_fields", need: ["user_id", "face_token", "feature_vector"] }, 422);
  BY_TOKEN.set(String(b.face_token), { user_id: String(b.user_id), feature_vector: String(b.feature_vector), enrolled_at: "runtime" });
  return json({ enrolled: b.user_id, face_token: b.face_token });
}

async function liveness(req: Request): Promise<Response> {
  const b = await safeJson(req);
  // 沙箱：有 challenge 即视为通过（真实做防重放 challenge-response）
  return json({ passed: true, challenge: b.challenge ?? null, face_token: b.face_token ?? null });
}

async function safeJson(req: Request): Promise<Record<string, any>> {
  try { return await req.json(); } catch { return {}; }
}
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
