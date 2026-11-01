"""项目结构记录的公共构造函数，不包含目标代码执行行为。"""

from __future__ import annotations

import hashlib
from typing import Any


def make_id(prefix: str, *parts: object) -> str:
    """根据文件、种类与位置生成本次分析中的实体标识。

    Args:
        prefix (str): 记录种类前缀。
        *parts (object): 能唯一描述源码位置的组成部分。

    Returns:
        str: 可用于页面及索引关联的稳定字符串。
    """
    payload = "\0".join(str(part) for part in parts)
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}:{digest}"


def entity_record(
    entity_id: str,
    file_id: str,
    kind: str,
    name: str,
    qualname: str,
    parent_id: str | None,
    source_range: dict,
) -> dict[str, Any]:
    """创建字段一致的源码实体记录。

    Args:
        entity_id (str): 实体标识。
        file_id (str): 定义所在文件标识。
        kind (str): 模块、函数、类或绑定等实体种类。
        name (str): 源码中的名称。
        qualname (str): 包含外层作用域的展示名称。
        parent_id (str | None): 父作用域实体标识。
        source_range (dict): 定义的 UTF-16 源码范围。

    Returns:
        dict[str, Any]: 可直接序列化的实体记录。
    """
    return {
        "id": entity_id,
        "file_id": file_id,
        "kind": kind,
        "name": name,
        "qualname": qualname,
        "parent_id": parent_id,
        "range": source_range,
        "name_range": source_range,
        "docstring": "",
        "comments": [],
        "signature": "",
        "params": [],
        "returns": [],
        "return_annotation": "",
        "locals": [],
        "members": [],
        "bases": [],
        "annotation": "",
        "value": "",
        "logic": [],
        "is_async": False,
    }


def empty_snapshot(root: str, source_roots: list[str]) -> dict[str, Any]:
    """创建一次项目分析所需的纯数据容器。

    Args:
        root (str): 已规范化的项目根目录。
        source_roots (list[str]): 明确选择的源码搜索根目录。

    Returns:
        dict[str, Any]: 不含语法树或运行时对象的项目容器。
    """
    return {
        "root": root,
        "source_roots": source_roots,
        "files": {},
        "entities": {},
        "calls": {},
        "references": {},
        "diagnostics": [],
        "entrypoints": [],
        "excluded": [],
    }
