"""模型 JSON 输出解析工具（容忍代码块包裹、前后废话、字符串内换行）。"""
from __future__ import annotations

import json
import re


def extract_json(raw: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.S)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("模型输出缺少 JSON 结构")
    return json.loads(text[start : end + 1], strict=False)
