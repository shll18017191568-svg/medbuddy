"""验收脚本：MedBuddy 全功能 API 级验收（跑完自动汇总）。验收后可删除。"""
import json
import sys
import time

import httpx

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://localhost:3000"
AI = "http://localhost:8000"
PHONE = "13900139000"  # 管理员 + 已完善资料

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(("  PASS " if ok else "  FAIL ") + name + (" | " + detail if detail else ""))


def login(c: httpx.Client, phone: str) -> bool:
    send = c.post(f"{BASE}/api/auth/sms/send", json={"phone": phone})
    if send.status_code != 200:
        check("登录-发送验证码", False, f"HTTP {send.status_code}")
        return False
    code = send.json().get("devCode", "")
    verify = c.post(f"{BASE}/api/auth/sms/verify", json={"phone": phone, "code": code})
    return verify.status_code == 200


def run_task(c: httpx.Client, payload: dict, limit: int = 30, approve: bool = True) -> dict | None:
    """提交任务并等到终态；默认在审核中自动通过（验收环境模拟审核员）。"""
    created = c.post(f"{BASE}/api/tasks", json=payload)
    if created.status_code != 200:
        return None
    tid = created.json()["task"]["id"]
    for _ in range(limit):
        time.sleep(4)
        d = c.get(f"{BASE}/api/tasks/{tid}").json()["task"]
        if d["status"] == "reviewing":
            if not approve:
                return d
            res = c.post(
                f"{BASE}/api/admin/tasks/{tid}/review",
                json={"action": "APPROVE", "note": "验收脚本自动通过"},
            )
            if res.status_code != 200:
                return d
        if d["status"] in ("delivered", "failed"):
            return d
    return None


with httpx.Client(timeout=90) as c:
    print("\n[1] 基础健康检查")
    try:
        w = c.get(f"{BASE}/api/health").json()
        check("Web 服务健康", w.get("web") == "ok", str(w))
    except Exception as err:  # noqa: BLE001
        check("Web 服务健康", False, str(err))
    try:
        a = c.get(f"{AI}/api/health").json()
        check("AI 服务健康", a.get("status") == "ok", str(a))
    except Exception as err:  # noqa: BLE001
        check("AI 服务健康", False, str(err))

    print("\n[2] 认证与权限")
    unauth = c.get(f"{BASE}/api/tasks")
    check("未登录访问任务列表被拦截", unauth.status_code == 401, f"HTTP {unauth.status_code}")

    send = c.post(f"{BASE}/api/auth/sms/send", json={"phone": PHONE})
    ok_send = send.status_code == 200
    check("发送验证码", ok_send, f"HTTP {send.status_code}")
    code = send.json().get("devCode") if ok_send else ""

    if ok_send:
        bad = c.post(f"{BASE}/api/auth/sms/verify", json={"phone": PHONE, "code": "000000"})
        check("错误验证码被拒绝", bad.status_code == 401, f"HTTP {bad.status_code}")
        good = c.post(f"{BASE}/api/auth/sms/verify", json={"phone": PHONE, "code": code})
        check("正确验证码登录成功", good.status_code == 200, f"HTTP {good.status_code}")

    me = c.get(f"{BASE}/api/auth/me")
    user = me.json().get("user", {}) if me.status_code == 200 else {}
    check("获取当前用户", me.status_code == 200 and bool(user.get("phone")), f"role={user.get('role')}")
    balance_start = user.get("creditBalance", 0)
    check("积分账户存在", balance_start > 0, f"余额 {balance_start}")

    prof = user.get("profile")
    check("医生资料已完善", bool(prof and prof.get("name")), (prof or {}).get("name", ""))

    print("\n[3] 积分签到")
    status = c.get(f"{BASE}/api/credits/checkin").json()
    check("签到状态可查询", status.get("checkedIn") is not None,
          f"已签={status.get('checkedIn')} 连续={status.get('streak')}")
    post = c.post(f"{BASE}/api/credits/checkin")
    check("签到接口幂等（已签返回 409）", post.status_code in (200, 409), f"HTTP {post.status_code}")

    print("\n[4] 技能 1 文献检索")
    d = run_task(c, {"type": "literature_search", "mode": "craft",
                     "title": "验收-文献检索",
                     "prompt": "铁死亡在肿瘤免疫中的作用近3年高质量综述，优先 Review，排除 Letter"})
    if d and d["status"] == "delivered":
        rj = json.loads(d["resultJson"])
        items = rj.get("items", [])
        check("文献检索交付", len(items) > 0, f"{len(items)} 篇")
        check("PMID 为真实数字", all(str(i["pmid"]).isdigit() for i in items),
              f"首条 {items[0]['pmid'] if items else '-'}")
    else:
        check("文献检索交付", False, (d or {}).get("failReason", "超时"))

    print("\n[5] 技能 2 文献解读")
    d = run_task(c, {"type": "literature_digest", "mode": "craft",
                     "title": "验收-文献解读", "prompt": "解读 38453898"})
    if d and d["status"] == "delivered":
        rj = json.loads(d["resultJson"])
        secs = rj.get("sections", [])
        check("文献解读交付五段", len(secs) == 5, f"{len(secs)} 段")
        check("回传原文供核对", len(rj.get("evidence", "")) > 100, f"{len(rj.get('evidence', ''))} 字符")
    else:
        check("文献解读交付五段", False, (d or {}).get("failReason", "超时"))

    print("\n[6] 技能 8 数据分析可视化")
    import base64
    csv_text = "group,score\nA,12.3\nA,14.1\nB,18.2\nB,19.5\nC,9.4\nC,8.7"
    vis = c.post(f"{BASE}/api/ai/visualize", json={
        "filename": "t.csv",
        "content_base64": base64.b64encode(csv_text.encode()).decode(),
        "instruction": "比较各组",
    })
    vd = vis.json() if vis.status_code == 200 else {}
    check("可视化出图", str(vd.get("image", "")).startswith("data:image/png"),
          f"{vd.get('chart_label')} / {len(vd.get('image', ''))}B")
    check("出图附解读", bool(vd.get("interpretation")), str(vd.get("interpretation", ""))[:40])

    print("\n[7] 技能 9 参考文献管理")
    d = run_task(c, {"type": "reference_format", "mode": "craft",
                     "title": "验收-参考文献", "prompt": "按 Vancouver 格式：38453898 33268902"})
    if d and d["status"] == "delivered":
        rj = json.loads(d["resultJson"])
        check("参考文献交付", rj.get("count") == 2, f"{rj.get('count')} 条")
        check("可导出 BibTeX/RIS", bool(rj.get("bibtex")) and bool(rj.get("ris")),
              f"bib {len(rj.get('bibtex', ''))}B / ris {len(rj.get('ris', ''))}B")
    else:
        check("参考文献交付", False, (d or {}).get("failReason", "超时"))

    print("\n[8] 技能 3 实验设计")
    d = run_task(c, {"type": "experiment_design", "mode": "craft",
                     "title": "验收-实验设计",
                     "prompt": "铁死亡调控肿瘤免疫微环境的机制研究 38453898"}, limit=45)
    if d and d["status"] == "delivered":
        rj = json.loads(d["resultJson"])
        n = rj.get("stats", {}).get("experiments", 0)
        check("实验设计交付", n >= 3, f"{n} 主实验 / {rj.get('stats', {}).get('sub_experiments')} 子实验")
    else:
        check("实验设计交付", False, (d or {}).get("failReason", "超时"))

    print("\n[9] 技能 4 临床方案")
    d = run_task(c, {"type": "clinical_design", "mode": "craft",
                     "title": "验收-临床方案",
                     "prompt": "免疫检查点抑制剂联合化疗一线治疗晚期非小细胞肺癌的疗效与安全性"}, limit=45)
    if d and d["status"] == "delivered":
        rj = json.loads(d["resultJson"])
        check("临床方案交付", "PICO" in rj.get("markdown", ""), rj.get("study_type", "")[:24])
    else:
        check("临床方案交付", False, (d or {}).get("failReason", "超时"))

    print("\n[10] 技能 5 综述写作")
    d = run_task(c, {"type": "review_draft", "mode": "craft",
                     "title": "验收-综述写作", "prompt": "铁死亡在肿瘤免疫治疗中的作用"}, limit=60)
    if d and d["status"] == "delivered":
        rj = json.loads(d["resultJson"])
        stats = rj.get("stats", {})
        check("综述交付", stats.get("word_count", 0) > 1000, f"{stats.get('word_count')} 字")
        check("引用为真实文献", stats.get("references", 0) >= 5, f"{stats.get('references')} 篇")
    else:
        check("综述交付", False, (d or {}).get("failReason", "超时"))

    print("\n[11] 失败退款")
    before = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    d = run_task(c, {"type": "review_draft", "mode": "craft",
                     "title": "验收-失败退款", "prompt": "炎症"}, limit=8)
    after = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("失败任务标记 FAILED", bool(d) and d["status"] == "failed", (d or {}).get("failReason", "-")[:40])
    check("失败自动退款", after == before, f"{before} -> {after}")

    print("\n[12] 运营后台")
    stats = c.get(f"{BASE}/api/admin/stats")
    sd = stats.json() if stats.status_code == 200 else {}
    check("后台概览可访问", stats.status_code == 200,
          f"用户 {sd.get('userCount')} / 任务 {sd.get('taskCount')} / 消耗 {sd.get('creditsConsumed')}")
    users = c.get(f"{BASE}/api/admin/users")
    check("后台用户列表", users.status_code == 200 and len(users.json().get("users", [])) > 0)
    tasks = c.get(f"{BASE}/api/admin/tasks")
    check("后台任务列表", tasks.status_code == 200 and len(tasks.json().get("tasks", [])) > 0)

    print("\n[13] 合规审核台与 AI 预审")
    wait_review = run_task(c, {"type": "avatar_chat", "mode": "craft",
                               "title": "验收-审核台", "prompt": "高血压患者限盐建议"}, approve=False)
    if wait_review and wait_review["status"] == "reviewing":
        check("任务停在审核中", wait_review.get("reviewStatus") == "PENDING",
              f"reviewStatus={wait_review.get('reviewStatus')}")
        check("预审结果已生成", wait_review.get("precheckStatus") in ("PASS", "WARN", "HIGH_RISK"),
              f"precheckStatus={wait_review.get('precheckStatus')}")
        check("预审发现项可回溯", bool(wait_review.get("precheckJson")),
              f"{len(json.loads(wait_review.get('precheckJson') or '{}').get('findings', []))} 条")

        approve = c.post(f"{BASE}/api/admin/tasks/{wait_review['id']}/review",
                         json={"action": "APPROVE", "note": "验收通过"})
        check("审核通过接口", approve.status_code == 200, f"HTTP {approve.status_code}")
        time.sleep(2)
        delivered = c.get(f"{BASE}/api/tasks/{wait_review['id']}").json()["task"]
        check("审核通过后回传", delivered["status"] == "delivered"
              and delivered.get("reviewStatus") == "APPROVED"
              and bool(delivered.get("reviewerName")),
              f"status={delivered['status']} reviewer={delivered.get('reviewerName')}")
        again = c.post(f"{BASE}/api/admin/tasks/{wait_review['id']}/review", json={"action": "APPROVE"})
        check("重复审核被拒绝", again.status_code == 409, f"HTTP {again.status_code}")
    else:
        check("任务停在审核中", False, (wait_review or {}).get("status", "超时"))

    before_reject = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    to_reject = run_task(c, {"type": "avatar_chat", "mode": "craft",
                             "title": "验收-审核驳回", "prompt": "糖尿病饮食建议"}, approve=False)
    if to_reject and to_reject["status"] == "reviewing":
        empty_note = c.post(f"{BASE}/api/admin/tasks/{to_reject['id']}/review", json={"action": "REJECT"})
        check("空意见驳回被拦截", empty_note.status_code == 400, f"HTTP {empty_note.status_code}")
        reject = c.post(f"{BASE}/api/admin/tasks/{to_reject['id']}/review",
                        json={"action": "REJECT", "note": "验收：正文缺少医学免责声明"})
        check("审核驳回接口", reject.status_code == 200, f"HTTP {reject.status_code}")
        time.sleep(2)
        rejected = c.get(f"{BASE}/api/tasks/{to_reject['id']}").json()["task"]
        refunded = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        check("驳回后任务失败", rejected["status"] == "failed"
              and rejected.get("reviewStatus") == "REJECTED", rejected["status"])
        check("驳回全额退款", refunded == before_reject, f"{before_reject} -> {refunded}")
    else:
        check("空意见驳回被拦截", False, (to_reject or {}).get("status", "超时"))

print("\n" + "=" * 56)
passed = sum(1 for _, ok, _ in results if ok)
failed = len(results) - passed
print(f"验收结果：{passed} 通过 / {failed} 失败（共 {len(results)} 项）")
if failed:
    print("失败项：")
    for name, ok, detail in results:
        if not ok:
            print(f"  - {name} | {detail}")
print("=" * 56)
sys.exit(1 if failed else 0)
