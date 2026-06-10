// 冒烟：复刻 harness identity 契约的可外部化部分（verify 1:N + 活体 + INV-8 登记）。
import worker from "../src/index.ts";

function makeReq(method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = {};
  let data: string | undefined;
  if (body !== undefined) { headers["content-type"] = "application/json"; data = JSON.stringify(body); }
  return new Request("http://identity" + path, { method, headers, body: data });
}
async function call(method: string, path: string, body?: unknown) {
  const r = await (worker as any).fetch(makeReq(method, path, body));
  return { status: r.status, body: await r.json() as any };
}
const B = "/identity/v1";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, JSON.stringify(extra)); }
}

await call("POST", `${B}/_reset`);

// verify 已知 → user_id + 活体 + method=face
let v = await call("POST", `${B}/verify`, { face_token: "face_u_1001" });
check("verify 已知→u_1001", v.body.identity?.user_id === "u_1001", v.body);
check("verify 活体+verified", v.body.identity?.liveness === true && v.body.identity?.verified === true, v.body);
check("verify method=face", v.body.identity?.method === "face", v.body);

// verify 陌生人 → 404
const stranger = await call("POST", `${B}/verify`, { face_token: "face_stranger" });
check("陌生人→404", stranger.status === 404, stranger);

// enroll 新用户 → 之后可识别
const en = await call("POST", `${B}/enroll`, { user_id: "u_2001", face_token: "face_u_2001", feature_vector: "vec:2001" });
check("enroll 成功", en.body.enrolled === "u_2001", en.body);
const v2 = await call("POST", `${B}/verify`, { face_token: "face_u_2001" });
check("enroll 后可识别", v2.body.identity?.user_id === "u_2001", v2.body);

// INV-8：上送原始图像被拒
const raw = await call("POST", `${B}/enroll`, { user_id: "u_x", face_token: "f_x", feature_vector: "v", image: "BASE64..." });
check("INV-8 拒绝原始图像→422", raw.status === 422 && raw.body.error === "inv8_raw_image_rejected", raw);

// 缺特征向量被拒
const miss = await call("POST", `${B}/enroll`, { user_id: "u_y", face_token: "f_y" });
check("缺 feature_vector→422", miss.status === 422, miss);

// 防劫持：已绑定 face_u_1001 的 token 不可被改绑到 attacker
const hijack = await call("POST", `${B}/enroll`, { user_id: "attacker", face_token: "face_u_1001", feature_vector: "v" });
check("劫持已绑定 token → 409", hijack.status === 409, hijack);
const stillMine = await call("POST", `${B}/verify`, { face_token: "face_u_1001" });
check("种子映射未被劫持", stillMine.body.identity?.user_id === "u_1001", stillMine.body);

// liveness challenge
const live = await call("POST", `${B}/liveness`, { face_token: "face_u_1001", challenge: "c123" });
check("liveness 通过", live.body.passed === true && live.body.challenge === "c123", live.body);

// users 查询
const u = await call("GET", `${B}/users/u_1002`);
check("users 已登记", u.body.enrolled === true, u.body);

const health = await call("GET", "/health");
check("health ok", health.body.ok === true, health.body);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
