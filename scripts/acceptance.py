"""验收脚本：MedBuddy 全功能 API 与数据库验收（跑完自动汇总）。验收后可删除。"""
import json
from pathlib import Path
import re
import sqlite3
import sys
import time

import httpx

sys.stdout.reconfigure(encoding="utf-8")

BASE = "http://localhost:3000"
AI = "http://localhost:8000"
DB = str(Path(__file__).resolve().parents[1] / "apps" / "web" / "prisma" / "dev.db")
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

    print("\n[14] 支付链路（积分充值 + 会员开通，可重复运行）")
    bal0 = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    rc = c.post(f"{BASE}/api/credits/recharge", json={"packageId": "starter", "provider": "mock"})
    order = rc.json().get("order", {}) if rc.status_code == 200 else {}
    check("充值下单返回待支付订单", rc.status_code == 200
          and order.get("amountFen") == 1000 and order.get("status") == "PENDING"
          and str(order.get("outTradeNo", "")).startswith("MB"),
          f"HTTP {rc.status_code} {order.get('outTradeNo')}")

    pay = c.post(f"{BASE}/api/payments/mock/pay", json={"outTradeNo": order.get("outTradeNo")})
    bal1 = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("模拟支付入账 1000 积分", pay.status_code == 200 and bal1 == bal0 + 1000,
          f"{bal0} -> {bal1}")

    c.post(f"{BASE}/api/payments/mock/pay", json={"outTradeNo": order.get("outTradeNo")})
    dup = c.post(f"{BASE}/api/payments/callback/mock", json={
        "outTradeNo": order.get("outTradeNo"),
        "transactionId": f"MOCK-{order.get('outTradeNo')}",
        "amountFen": 1000, "success": True})
    bal2 = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("重复支付与重复回调不重复入账", dup.text == "success" and bal2 == bal1,
          f"{bal1} -> {bal2}")

    info = c.get(f"{BASE}/api/payments/orders/{order.get('id')}")
    check("订单状态查询为已支付", info.status_code == 200
          and info.json().get("order", {}).get("status") == "PAID",
          f"HTTP {info.status_code}")

    rc2 = c.post(f"{BASE}/api/credits/recharge", json={"packageId": "starter"})
    order2 = rc2.json().get("order", {}) if rc2.status_code == 200 else {}
    tampered = c.post(f"{BASE}/api/payments/callback/mock", json={
        "outTradeNo": order2.get("outTradeNo"),
        "transactionId": f"MOCK-{order2.get('outTradeNo')}",
        "amountFen": 1, "success": True})
    bal3 = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("篡改金额回调被拒绝且不入账", tampered.text == "failure" and bal3 == bal2,
          f"回调 {tampered.text} / 余额 {bal2} -> {bal3}")

    m0 = c.get(f"{BASE}/api/membership").json()
    current = m0.get("current") or {}
    old_expire = current.get("expireAt")
    # 已是旗舰版时只能续费旗舰（降级购买应被拦截），否则购买专业版
    is_flagship = current.get("level") == "flagship" and bool(old_expire)
    buy_level = "flagship" if is_flagship else "pro"
    expect_fen = 29900 if is_flagship else 9900
    expect_credits = 10000 if is_flagship else 3000

    bad_buy = c.post(f"{BASE}/api/membership/subscribe",
                     json={"level": "pro" if is_flagship else "free"})
    check("降级/非法购买被拒绝", bad_buy.status_code == 400,
          f"当前 {current.get('level')} HTTP {bad_buy.status_code}")

    sub = c.post(f"{BASE}/api/membership/subscribe", json={"level": buy_level, "provider": "mock"})
    mo = sub.json().get("order", {}) if sub.status_code == 200 else {}
    bal_before_member = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("会员下单成功且支付前不赠积分", sub.status_code == 200
          and str(mo.get("outTradeNo", "")).startswith("MM") and mo.get("amountFen") == expect_fen
          and bal_before_member == bal3,
          f"HTTP {sub.status_code} {mo.get('outTradeNo')} 购买 {buy_level}")

    mpay = c.post(f"{BASE}/api/payments/mock/pay", json={"outTradeNo": mo.get("outTradeNo")})
    m1 = c.get(f"{BASE}/api/membership").json()
    new_expire = (m1.get("current") or {}).get("expireAt")
    check(f"会员支付后赠送 {expect_credits} 积分", mpay.status_code == 200
          and m1.get("balance") == bal_before_member + expect_credits,
          f"{bal_before_member} -> {m1.get('balance')}")
    check("会员等级生效", (m1.get("current") or {}).get("level") in ("pro", "flagship"),
          f"level={(m1.get('current') or {}).get('level')}")
    check("会员到期时间顺延", bool(new_expire) and (not old_expire or new_expire > old_expire),
          f"{old_expire} -> {new_expire}")

    print("\n[15] 订单管理与退款冲正（独立测试账号）")

    def paid_recharge(client: httpx.Client) -> tuple[dict, httpx.Response]:
        created = client.post(f"{BASE}/api/credits/recharge",
                              json={"packageId": "starter", "provider": "mock"})
        order = created.json().get("order", {}) if created.status_code == 200 else {}
        paid = client.post(f"{BASE}/api/payments/mock/pay",
                           json={"outTradeNo": order.get("outTradeNo")})
        return order, paid

    def paid_membership(client: httpx.Client) -> tuple[dict, httpx.Response]:
        created = client.post(f"{BASE}/api/membership/subscribe",
                              json={"level": "pro", "provider": "mock"})
        order = created.json().get("order", {}) if created.status_code == 200 else {}
        paid = client.post(f"{BASE}/api/payments/mock/pay",
                           json={"outTradeNo": order.get("outTradeNo")})
        return order, paid

    def refund_order(client: httpx.Client, kind: str, order_id: str | None,
                     reason: str = "全量验收退款冲正") -> httpx.Response:
        return client.post(f"{BASE}/api/admin/orders/refund",
                           json={"kind": kind, "orderId": order_id, "reason": reason})

    test_phone = f"136{int(time.time() * 1000) % 100000000:08d}"
    with httpx.Client(timeout=90) as order_user:
        logged_in = login(order_user, test_phone)
        test_me = order_user.get(f"{BASE}/api/auth/me").json().get("user", {})
        test_user_id = test_me.get("id")
        check("订单测试独立账号注册", logged_in and test_me.get("role") == "DOCTOR", test_phone)
        check("非管理员订单列表 403", order_user.get(f"{BASE}/api/admin/orders").status_code == 403)
        check("非管理员退款接口 403",
              refund_order(order_user, "recharge", "not-found").status_code == 403)

        order_list = c.get(f"{BASE}/api/admin/orders?kind=recharge")
        reconciliation = order_list.json().get("reconciliation", {}) if order_list.status_code == 200 else {}
        check("管理员订单列表与对账返回", order_list.status_code == 200
              and all(key in reconciliation for key in ("recharge", "membership", "total")))

        start_balance = order_user.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        recharge, recharge_pay = paid_recharge(order_user)
        after_pay = order_user.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        check("退款验收充值支付入账", recharge_pay.status_code == 200
              and after_pay == start_balance + 1000, f"{start_balance} -> {after_pay}")
        missing_reason = refund_order(c, "recharge", recharge.get("id"), "   ")
        check("退款原因必填", missing_reason.status_code == 400, f"HTTP {missing_reason.status_code}")
        refunded = refund_order(c, "recharge", recharge.get("id"))
        refunded_data = refunded.json() if refunded.status_code == 200 else {}
        after_refund = order_user.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        check("充值退款扣回积分", refunded.status_code == 200
              and refunded_data.get("refundedCredits") == 1000 and after_refund == start_balance,
              f"余额 {after_refund}")
        check("重复充值退款拒绝",
              refund_order(c, "recharge", recharge.get("id")).status_code == 409)

        with sqlite3.connect(DB, timeout=30) as conn:
            row = conn.execute("SELECT status FROM RechargeOrder WHERE id = ?",
                               (recharge.get("id"),)).fetchone()
            ledger = conn.execute(
                "SELECT amount, note FROM CreditLedger WHERE userId = ? AND note LIKE ? "
                "ORDER BY createdAt DESC LIMIT 1",
                (test_user_id, f"%{recharge.get('outTradeNo')}%")).fetchone()
        check("充值退款状态与负数流水", bool(row and row[0] == "REFUNDED"
              and ledger and ledger[0] == -1000 and "全量验收" in ledger[1]))

        first_member, _ = paid_membership(order_user)
        second_member, _ = paid_membership(order_user)
        member_now = order_user.get(f"{BASE}/api/auth/me").json()["user"].get("membership", {})
        check("续费后会员仍有效", member_now.get("level") == "pro", str(member_now.get("level")))
        earlier_refund = refund_order(c, "membership", first_member.get("id"))
        check("存在后续续费时拒绝退款", earlier_refund.status_code == 409
              and "续费" in earlier_refund.json().get("error", ""),
              earlier_refund.json().get("error", ""))
        before_member_refund = order_user.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        member_refund = refund_order(c, "membership", second_member.get("id"))
        member_refund_data = member_refund.json() if member_refund.status_code == 200 else {}
        after_member = order_user.get(f"{BASE}/api/auth/me").json()["user"]
        check("会员退款撤销等级与赠送", member_refund.status_code == 200
              and member_refund_data.get("refundedCredits") == 3000
              and after_member.get("creditBalance") == before_member_refund - 3000
              and after_member.get("membership", {}).get("level") == "free"
              and after_member.get("membership", {}).get("expireAt") is None)
        check("重复会员退款拒绝",
              refund_order(c, "membership", second_member.get("id")).status_code == 409)
        with sqlite3.connect(DB, timeout=30) as conn:
            member_row = conn.execute("SELECT memberLevel, memberExpireAt FROM User WHERE id = ?",
                                      (test_user_id,)).fetchone()
            member_ledger = conn.execute(
                "SELECT amount FROM CreditLedger WHERE userId = ? AND note LIKE ? "
                "ORDER BY createdAt DESC LIMIT 1",
                (test_user_id, f"%{second_member.get('outTradeNo')}%")).fetchone()
        check("会员退款数据库冲正", member_row == ("free", None)
              and bool(member_ledger and member_ledger[0] == -3000))

        real_order, _ = paid_recharge(order_user)
        with sqlite3.connect(DB, timeout=30) as conn:
            conn.execute("UPDATE RechargeOrder SET provider = 'wechat', updatedAt = CURRENT_TIMESTAMP "
                         "WHERE id = ?", (real_order.get("id"),))
            conn.commit()
        real_result = refund_order(c, "recharge", real_order.get("id"))
        check("真实渠道提示商户后台退款", real_result.status_code == 409
              and "商户后台" in real_result.json().get("error", ""),
              real_result.json().get("error", ""))
        with sqlite3.connect(DB, timeout=30) as conn:
            real_row = conn.execute("SELECT provider, status FROM RechargeOrder WHERE id = ?",
                                    (real_order.get("id"),)).fetchone()
        check("真实渠道拒绝后订单不变", real_row == ("wechat", "PAID"))

        insufficient_order, _ = paid_recharge(order_user)
        with sqlite3.connect(DB, timeout=30) as conn:
            conn.execute("UPDATE CreditAccount SET balance = 0, updatedAt = CURRENT_TIMESTAMP "
                         "WHERE userId = ?", (test_user_id,))
            conn.commit()
        insufficient = refund_order(c, "recharge", insufficient_order.get("id"))
        check("积分不足时拒绝充值退款", insufficient.status_code == 409
              and "余额不足" in insufficient.json().get("error", ""),
              insufficient.json().get("error", ""))
        with sqlite3.connect(DB, timeout=30) as conn:
            insufficient_row = conn.execute("SELECT status FROM RechargeOrder WHERE id = ?",
                                            (insufficient_order.get("id"),)).fetchone()
        check("积分不足不修改订单状态", bool(insufficient_row and insufficient_row[0] == "PAID"))

        recharge_list = c.get(f"{BASE}/api/admin/orders?kind=recharge&status=PAID")
        membership_list = c.get(f"{BASE}/api/admin/orders?kind=membership&status=REFUNDED")
        recharge_orders = recharge_list.json().get("orders", []) if recharge_list.status_code == 200 else []
        membership_orders = membership_list.json().get("orders", []) if membership_list.status_code == 200 else []
        check("充值状态筛选与会员退款列表", recharge_list.status_code == 200
              and all(order.get("status") == "PAID" for order in recharge_orders)
              and any(order.get("id") == second_member.get("id") for order in membership_orders))
        check("订单管理页面可访问", c.get(f"{BASE}/admin/orders").status_code == 200)

    print("\n[16] 邀请奖励（独立测试账号）")

    def register(client: httpx.Client, phone: str, invite: str | None = None) -> httpx.Response:
        sent = client.post(f"{BASE}/api/auth/sms/send", json={"phone": phone})
        code = sent.json().get("devCode", "") if sent.status_code == 200 else ""
        body = {"phone": phone, "code": code}
        if invite is not None:
            body["inviteCode"] = invite
        return client.post(f"{BASE}/api/auth/sms/verify", json=body)

    invite_stamp = str(int(time.time() * 1000))[-8:]
    with httpx.Client(timeout=60) as inviter, httpx.Client(timeout=60) as invitee:
        inviter_phone = f"138{invite_stamp}"
        invitee_phone = f"137{invite_stamp}"
        ghost_phone = f"135{invite_stamp}"
        check("邀请人注册成功", register(inviter, inviter_phone).status_code == 200)
        invite_info = inviter.get(f"{BASE}/api/invite")
        invite_code = invite_info.json().get("code", "") if invite_info.status_code == 200 else ""
        check("邀请码自动生成且稳定", len(invite_code) == 6
              and inviter.get(f"{BASE}/api/invite").json().get("code") == invite_code, invite_code)

        bad_invite = register(invitee, ghost_phone, "ZZZZZZ")
        check("非法邀请码注册被拒", bad_invite.status_code == 400
              and "邀请码" in bad_invite.json().get("error", ""),
              bad_invite.json().get("error", ""))

        joined = register(invitee, invitee_phone, invite_code.lower())
        invitee_balance = invitee.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        check("受邀注册得 500 积分", joined.status_code == 200 and invitee_balance == 10500,
              f"余额 {invitee_balance}")

        inviter_balance = inviter.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
        invite_stats = inviter.get(f"{BASE}/api/invite").json()
        check("邀请人得 1000 积分", inviter_balance == 11000, f"余额 {inviter_balance}")
        check("邀请战绩累计", invite_stats.get("invitedCount") == 1
              and invite_stats.get("inviteEarned") == 1000,
              f"{invite_stats.get('invitedCount')} 位 / {invite_stats.get('inviteEarned')} 分")

        with sqlite3.connect(DB, timeout=30) as conn:
            inviter_id = conn.execute("SELECT id FROM User WHERE phone = ?", (inviter_phone,)).fetchone()[0]
            invited = conn.execute("SELECT id, invitedById FROM User WHERE phone = ?", (invitee_phone,)).fetchone()
            invite_ledgers = conn.execute(
                "SELECT userId, amount FROM CreditLedger WHERE type = 'INVITE' AND userId IN (?, ?)",
                (inviter_id, invited[0] if invited else "")).fetchall()
        check("邀请关系与双方流水", bool(invited and invited[1] == inviter_id)
              and {(row[0], row[1]) for row in invite_ledgers} == {(inviter_id, 1000), (invited[0], 500)},
              str(invite_ledgers))
        check("邀请页可访问", inviter.get(f"{BASE}/invite").status_code == 200)

    print("\n[17] PLAN 模式：先方案后执行")
    bal_plan_start = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    pc = c.post(f"{BASE}/api/tasks", json={
        "type": "literature_search", "mode": "plan",
        "title": "验收-PLAN文献检索", "prompt": "铁死亡在肿瘤免疫中的作用近3年综述",
    })
    check("PLAN 任务创建成功", pc.status_code == 200, f"HTTP {pc.status_code}")
    ptid = pc.json()["task"]["id"]
    check("PLAN 创建时不扣费", pc.json()["task"]["creditCost"] == 0
          and c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"] == bal_plan_start)
    plan_ready = None
    for _ in range(20):
        time.sleep(2)
        pt = c.get(f"{BASE}/api/tasks/{ptid}").json()["task"]
        if pt["status"] == "plan_ready":
            plan_ready = pt
            break
    check("方案生成到达 plan_ready", plan_ready is not None, (plan_ready or {}).get("status", "超时"))
    prj = json.loads(plan_ready["resultJson"]) if plan_ready else {}
    check("方案结构合法", prj.get("kind") == "plan" and len(prj.get("steps", [])) > 0
          and isinstance(prj.get("cost"), (int, float)), f"kind={prj.get('kind')}")
    plan_cost = prj.get("cost", 0)
    bal_before_confirm = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    conf = c.post(f"{BASE}/api/tasks/{ptid}/confirm")
    check("确认执行成功", conf.status_code == 200, f"HTTP {conf.status_code}")
    bal_after_confirm = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("确认扣费与方案价一致", bal_before_confirm - bal_after_confirm == plan_cost,
          f"方案价 {plan_cost} 实扣 {bal_before_confirm - bal_after_confirm}")
    plan_delivered = None
    for _ in range(30):
        time.sleep(4)
        pt = c.get(f"{BASE}/api/tasks/{ptid}").json()["task"]
        if pt["status"] == "reviewing":
            c.post(f"{BASE}/api/admin/tasks/{ptid}/review",
                   json={"action": "APPROVE", "note": "验收自动通过"})
        if pt["status"] in ("delivered", "failed"):
            plan_delivered = pt
            break
    check("PLAN 确认后最终交付", plan_delivered is not None and plan_delivered["status"] == "delivered",
          (plan_delivered or {}).get("status", "超时"))

    # 取消流程
    cc = c.post(f"{BASE}/api/tasks", json={
        "type": "literature_search", "mode": "plan",
        "title": "验收-PLAN取消", "prompt": "取消测试",
    })
    ctid = cc.json()["task"]["id"]
    for _ in range(20):
        time.sleep(2)
        ct = c.get(f"{BASE}/api/tasks/{ctid}").json()["task"]
        if ct["status"] == "plan_ready":
            break
    bal_cancel = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    cancel_res = c.post(f"{BASE}/api/tasks/{ctid}/cancel")
    check("取消方案成功", cancel_res.status_code == 200, f"HTTP {cancel_res.status_code}")
    ct = c.get(f"{BASE}/api/tasks/{ctid}").json()["task"]
    check("取消后状态为 failed 且不扣费", ct["status"] == "failed"
          and c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"] == bal_cancel,
          f"status={ct['status']}")

    # 重复确认防重
    dc = c.post(f"{BASE}/api/tasks", json={
        "type": "literature_search", "mode": "plan",
        "title": "验收-PLAN重复确认", "prompt": "重复确认测试",
    })
    dtid = dc.json()["task"]["id"]
    for _ in range(20):
        time.sleep(2)
        dt = c.get(f"{BASE}/api/tasks/{dtid}").json()["task"]
        if dt["status"] == "plan_ready":
            break
    c.post(f"{BASE}/api/tasks/{dtid}/confirm")
    double = c.post(f"{BASE}/api/tasks/{dtid}/confirm")
    check("重复确认返回 409", double.status_code == 409, f"HTTP {double.status_code}")

    print("\n[18] ASK 模式：仅问答（低价 + 跳过审核）")
    bal_ask_start = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    ac = c.post(f"{BASE}/api/tasks", json={
        "type": "literature_search", "mode": "ask",
        "title": "验收-ASK问答", "prompt": "什么是铁死亡？简述其在肿瘤免疫中的作用",
    })
    check("ASK 任务创建成功", ac.status_code == 200, f"HTTP {ac.status_code}")
    atask = ac.json()["task"]
    atid = atask["id"]
    check("ASK 扣费为低价(≤10)", 0 < atask["creditCost"] <= 10, f"cost={atask['creditCost']}")
    ask_cost = atask["creditCost"]
    ask_delivered = None
    ask_saw_review = False
    for _ in range(30):
        time.sleep(2)
        at = c.get(f"{BASE}/api/tasks/{atid}").json()["task"]
        if at["status"] == "reviewing":
            ask_saw_review = True
        if at["status"] in ("delivered", "failed"):
            ask_delivered = at
            break
    check("ASK 跳过审核直达 delivered", ask_delivered is not None
          and ask_delivered["status"] == "delivered" and not ask_saw_review,
          f"status={(ask_delivered or {}).get('status')}")
    arj = json.loads((ask_delivered or {}).get("resultJson") or "{}")
    check("ASK 结果为 answer 且非空", arj.get("kind") == "answer"
          and isinstance(arj.get("answer"), str) and len(arj["answer"]) > 0,
          f"kind={arj.get('kind')}")
    bal_ask_end = c.get(f"{BASE}/api/auth/me").json()["user"]["creditBalance"]
    check("ASK 扣费金额正确", bal_ask_start - bal_ask_end == ask_cost,
          f"before={bal_ask_start} after={bal_ask_end} cost={ask_cost}")

    print("\n[19] 交付后追问会话")
    gm = c.get(f"{BASE}/api/tasks/{atid}/messages")
    check("追问记录初始为空", gm.status_code == 200 and gm.json()["messages"] == [],
          f"HTTP {gm.status_code}")
    pm = c.post(f"{BASE}/api/tasks/{atid}/messages",
                json={"content": "这条结论的证据强度如何？需要注意什么？"})
    check("追问提交成功", pm.status_code == 200, f"HTTP {pm.status_code}")
    pdata = pm.json()
    pmsgs = pdata.get("messages", [])
    check("追问返回用户+助手两条", len(pmsgs) == 2 and pmsgs[0]["role"] == "user"
          and pmsgs[1]["role"] == "assistant" and len(pmsgs[1]["content"]) > 0,
          f"count={len(pmsgs)}")
    check("追问剩余次数正确", pdata.get("remaining") == 19, f"remaining={pdata.get('remaining')}")
    gm2 = c.get(f"{BASE}/api/tasks/{atid}/messages")
    check("追问记录已落库", len(gm2.json()["messages"]) == 2,
          f"count={len(gm2.json()['messages'])}")

    nc = c.post(f"{BASE}/api/tasks", json={
        "type": "literature_search", "mode": "plan",
        "title": "验收-未交付追问", "prompt": "测试未交付任务追问拦截",
    })
    ntid = nc.json()["task"]["id"]
    nm = c.post(f"{BASE}/api/tasks/{ntid}/messages", json={"content": "未交付可以追问吗"})
    check("未交付任务追问被拒 409", nm.status_code == 409, f"HTTP {nm.status_code}")
    em = c.post(f"{BASE}/api/tasks/{atid}/messages", json={"content": "   "})
    check("空追问被拒 400", em.status_code == 400, f"HTTP {em.status_code}")

    with httpx.Client(timeout=60) as outsider:
        login(outsider, "13618801001")
        om = outsider.get(f"{BASE}/api/tasks/{atid}/messages")
        check("他人追问记录不可见 404", om.status_code == 404, f"HTTP {om.status_code}")
        ow = outsider.post(f"{BASE}/api/tasks/{atid}/messages", json={"content": "越权追问"})
        check("他人不可追问 404", ow.status_code == 404, f"HTTP {ow.status_code}")

    print("\n[20] 技能中心（40 技能免费领取页）")
    sk = httpx.get(f"{BASE}/skills", timeout=60)
    check("技能中心公开可访问", sk.status_code == 200, f"HTTP {sk.status_code}")
    sk_html = re.sub(r"<!--.*?-->", "", sk.text)  # 去掉 React SSR 文本节点注释
    check("技能包总量 40 项", "40 项科研技能" in sk_html and "全部 40" in sk_html)
    check("已上线技能可见", "文献检索" in sk_html and "数字人播报" in sk_html,
          "文献检索/数字人播报")
    check("未上线技能标注", "即将上线" in sk_html)
    check("免费领取引导", "注册即" in sk_html and "手机号免费领取" in sk_html)
    check("技能使用条款挂链", "/legal/disclaimer" in sk_html)

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
