"""从源码索引生成文件详情、调用导航、搜索和可见关系图。"""

from __future__ import annotations

import hashlib
from collections import Counter, deque
from pathlib import Path

from .messages import coded_error


def _entity_brief(snapshot: dict, entity_id: str) -> dict | None:
    """取得实体并补充显示用模块信息。

    Args:
        snapshot (dict): 本次源码与关系索引。
        entity_id (str): 实体标识。

    Returns:
        dict | None: 实体副本或不存在时为空。
    """
    entity = snapshot["entities"].get(entity_id)
    if entity is None:
        return None
    result = dict(entity)
    record = snapshot["files"][entity["file_id"]]
    result["module"] = record["module"]
    result["relative_path"] = record["relative_path"]
    return result


def file_detail(snapshot: dict, file_id: str) -> dict:
    """生成文件说明、成员和双向符号引用详情。

    Args:
        snapshot (dict): 分析索引。
        file_id (str): 文件标识。

    Returns:
        dict: 不重复传输整份源码的文件详情。

    Raises:
        KeyError: 文件不存在。
    """
    record = snapshot["files"][file_id]
    result = {key: value for key, value in record.items() if key != "source"}
    result["members_detail"] = [
        item
        for entity_id in record.get("members", [])
        if (item := _entity_brief(snapshot, entity_id)) is not None
    ]
    result["references"] = [
        dict(reference)
        for reference in snapshot["references"].values()
        if reference["file_id"] == file_id
    ]
    result["incoming_references"] = [
        dict(reference)
        for reference in snapshot["references"].values()
        if reference["file_id"] != file_id
        and any(
            target.get("file_id") == file_id for target in reference.get("targets", [])
        )
    ]
    result["incoming_imports"] = []
    modules: dict[str, list[str]] = {}
    for source_id, source_file in snapshot["files"].items():
        modules.setdefault(source_file["module"], []).append(source_id)
    for source_id, source_file in snapshot["files"].items():
        if source_id == file_id:
            continue
        for imported in source_file.get("imports", []):
            if file_id in _import_destinations(source_file, imported, modules):
                result["incoming_imports"].append(
                    {
                        **imported,
                        "source_file_id": source_id,
                        "source_module": source_file["module"],
                        "source_relative_path": source_file["relative_path"],
                    }
                )
    result["reference_index"] = snapshot.get("reference_index", {})
    return result


def _argument_bindings(call: dict, target: dict | None) -> list[dict]:
    """对明确签名建立实参和形参的语法对照。

    Args:
        call (dict): 调用位置。
        target (dict | None): 唯一的项目内被调函数。

    Returns:
        list[dict]: 可明确对照的参数，不推测展开参数的内容。
    """
    if not target or target.get("decorators") or target.get("kind") == "method":
        return []
    arguments = call.get("args", [])
    if any(
        arg.get("kind") in {"star", "starred", "kwstar", "double_star"}
        or arg.get("expression", "").startswith(("*", "**"))
        for arg in arguments
    ):
        return []
    parameters = target.get("params", [])
    positional = [
        param
        for param in parameters
        if param.get("kind")
        in {
            "positional",
            "positional_only",
            "positional_or_keyword",
            "posonly",
            "arg",
        }
    ]
    # 方法可能经实例或类访问，原文对照保留，避免猜测隐式绑定。

    by_name = {param["name"]: param for param in parameters}
    result = []
    position = 0
    for argument in arguments:
        keyword = argument.get("name")
        if keyword:
            parameter = by_name.get(keyword)
            if parameter and parameter.get("kind") in {"positional_only", "posonly"}:
                parameter = None
        else:
            parameter = positional[position] if position < len(positional) else None
            position += 1
        if parameter:
            result.append(
                {
                    "argument": argument,
                    "parameter": parameter,
                    "parameter_name": parameter["name"],
                }
            )
    return result


def call_detail(snapshot: dict, call: dict) -> dict:
    """补充调用者、目标及可明确参数对照。

    Args:
        snapshot (dict): 分析索引。
        call (dict): 调用记录。

    Returns:
        dict: 可直接供详情面板显示的调用副本。
    """
    result = dict(call)
    owner = snapshot["entities"].get(call["owner_id"])
    file_record = snapshot["files"][call["file_id"]]
    result["owner_name"] = owner["qualname"] if owner else "模块"
    result["module"] = file_record["module"]
    result["relative_path"] = file_record["relative_path"]
    targets = call.get("targets", [])
    entity = None
    if len(targets) == 1:
        entity = snapshot["entities"].get(targets[0].get("entity_id"))
    result["argument_bindings"] = _argument_bindings(call, entity)
    return result


def entity_detail(snapshot: dict, entity_id: str) -> dict:
    """生成函数、类或变量的阅读详情及双向调用。

    Args:
        snapshot (dict): 分析索引。
        entity_id (str): 实体标识。

    Returns:
        dict: 说明、成员、对象及调用位置等详情。

    Raises:
        KeyError: 实体不存在。
    """
    result = _entity_brief(snapshot, entity_id)
    if result is None:
        raise KeyError(entity_id)
    result["members_detail"] = [
        item
        for child_id in result.get("members", [])
        if (item := _entity_brief(snapshot, child_id)) is not None
    ]
    result["locals_detail"] = [
        item
        for child_id in result.get("locals", [])
        if (item := _entity_brief(snapshot, child_id)) is not None
    ]
    result["outgoing"] = [
        call_detail(snapshot, call)
        for call in snapshot["calls"].values()
        if call["owner_id"] == entity_id
    ]
    result["incoming"] = [
        call_detail(snapshot, call)
        for call in snapshot["calls"].values()
        if any(
            target.get("entity_id") == entity_id for target in call.get("targets", [])
        )
    ]
    return result


def search(snapshot: dict, query: str, limit: int = 100) -> dict:
    """搜索文件、名称及限定名称。

    Args:
        snapshot (dict): 分析索引。
        query (str): 用户输入的文本。
        limit (int): 本次最多返回数量。

    Returns:
        dict: 匹配项、总量与未显示数量。
    """
    needle = query.strip().casefold()
    results = []
    for file_id, record in snapshot["files"].items():
        name = record["relative_path"]
        haystack = f"{name} {record['module']}".casefold()
        if not needle or needle in haystack:
            results.append(
                {
                    "type": "file",
                    "id": file_id,
                    "file_id": file_id,
                    "entity_id": None,
                    "name": name,
                    "label": name,
                    "kind": "file",
                    "module": record["module"],
                    "range": record.get("range"),
                }
            )
    for entity_id, entity in snapshot["entities"].items():
        if entity["kind"] == "module":
            continue
        record = snapshot["files"][entity["file_id"]]
        haystack = (
            f"{entity['name']} {entity['qualname']} {record['module']}"
        ).casefold()
        if not needle or needle in haystack:
            results.append(
                {
                    "type": "entity",
                    "id": entity_id,
                    "file_id": entity["file_id"],
                    "entity_id": entity_id,
                    "name": entity["name"],
                    "label": entity["qualname"],
                    "kind": entity["kind"],
                    "module": record["module"],
                    "range": entity["range"],
                }
            )
    results.sort(
        key=lambda item: (
            item["name"].casefold() != needle,
            not item["name"].casefold().startswith(needle),
            item["label"].casefold(),
        )
    )
    maximum = max(1, int(limit))
    return {
        "items": results[:maximum],
        "total": len(results),
        "remaining": max(0, len(results) - maximum),
    }


def _file_node(record: dict) -> dict:
    """将文件整理为关系图节点。

    Args:
        record (dict): 文件记录。

    Returns:
        dict: 可导航的文件图节点。
    """
    return {
        "id": record["id"],
        "label": record["module"] or record["relative_path"],
        "kind": "file",
        "file_id": record["id"],
        "entity_id": None,
        "module": record["module"],
        "scope": "project",
        "parse_status": record.get("parse_status"),
        "description": record["relative_path"],
    }


def _entity_node(snapshot: dict, entity: dict) -> dict:
    """将定义整理为保留作用域和位置的调用事实节点。

    Args:
        snapshot (dict): 分析索引。
        entity (dict): 定义记录。

    Returns:
        dict: 可导航且保持真实定义身份的节点。
    """
    record = snapshot["files"][entity["file_id"]]
    result = {
        "id": entity["id"],
        "label": entity["qualname"],
        "name": entity["name"],
        "qualname": entity["qualname"],
        "kind": entity["kind"],
        "file_id": entity["file_id"],
        "entity_id": entity["id"],
        "parent_id": entity["parent_id"],
        "range": entity["range"],
        "name_range": entity.get("name_range", entity["range"]),
        "relative_path": record["relative_path"],
        "module": record["module"],
        "scope": "project",
        "description": record["relative_path"],
    }
    if entity["kind"] == "module":
        result.update(label="模块顶层执行", message_code="graph.moduleBody", params={})
    return result


def _target_node(snapshot: dict, target: dict) -> dict:
    """将项目内或外部候选整理为图节点。

    Args:
        snapshot (dict): 分析索引。
        target (dict): 解析候选。

    Returns:
        dict: 候选定义图节点。
    """
    entity = snapshot["entities"].get(target.get("entity_id"))
    if entity:
        return _entity_node(snapshot, entity)
    return {
        "id": target["id"],
        "label": target.get("qualname") or target.get("name", "外部定义"),
        "kind": target.get("kind", "external"),
        "name": target.get("name", ""),
        "qualname": target.get("qualname") or target.get("name", ""),
        "parent_id": None,
        "range": target.get("range"),
        "relative_path": "",
        "file_id": target.get("file_id"),
        "entity_id": target.get("entity_id"),
        "module": target.get("module", ""),
        "scope": target.get("scope", "external"),
        "target": target,
    }


def _edge_key(kind: str, source: str, target: str) -> str:
    """为同一对关系端点生成可重复使用的标识。

    Args:
        kind (str): 关系种类。
        source (str): 起点标识。
        target (str): 终点标识。

    Returns:
        str: 稳定关系标识。
    """
    value = f"{kind}:{source}:{target}".encode("utf-8")
    return "edge:" + hashlib.sha256(value).hexdigest()[:20]


def _append_edge(
    edges: dict,
    kind: str,
    source: str,
    target: str,
    item_id: str,
    status: str = "resolved",
) -> None:
    """聚合同一对节点的关系并保留每个源码位置。

    Args:
        edges (dict): 正在构建的关系集合。
        kind (str): import、call 或 reference。
        source (str): 起点。
        target (str): 终点。
        item_id (str): 导入、调用或引用位置标识。
        status (str): 静态关系处理状态。

    Returns:
        None: 原位添加或更新关系。
    """
    key = _edge_key(kind, source, target)
    edge = edges.setdefault(
        key,
        {
            "id": key,
            "source": source,
            "target": target,
            "kind": kind,
            "label": "",
            "call_ids": [],
            "reference_ids": [],
            "import_ids": [],
            "statuses": [],
        },
    )
    bucket = {
        "call": "call_ids",
        "reference": "reference_ids",
        "import": "import_ids",
    }[kind]
    if item_id not in edge[bucket]:
        edge[bucket].append(item_id)
    if status not in edge["statuses"]:
        edge["statuses"].append(status)
    unit = {"call": "次调用", "reference": "处引用", "import": "处导入"}[kind]
    edge["label"] = f"{len(edge[bucket])} {unit}"
    edge["message_code"] = f"graph.edge_{kind}"
    edge["params"] = {"count": len(edge[bucket])}


def _declared_module(record: dict, imported: dict) -> str:
    """还原导入语句直接声明的模块名。

    Args:
        record (dict): 导入所在文件。
        imported (dict): 原始导入语句。

    Returns:
        str: 完整模块名，越过包边界时为空。
    """
    module = imported.get("module") or ""
    level = imported.get("level") or 0
    if not level:
        return module
    package = record["module"].split(".")
    if Path(record["path"]).stem != "__init__":
        package = package[:-1]
    if level > len(package):
        return ""
    prefix = package[: len(package) - level + 1]
    return ".".join([*prefix, *module.split(".")]).strip(".")


def _import_destinations(
    record: dict,
    imported: dict,
    modules: dict[str, list[str]],
) -> list[str]:
    """将直接导入的完整模块名映射到扫描范围内文件。

    Args:
        record (dict): 导入所在文件，含完整包层次。
        imported (dict): 原始导入语句与相对层级。
        modules (dict[str, list[str]]): 完整模块名到文件标识的映射。

    Returns:
        list[str]: 去重后的目的文件，保留同名模块的多个候选。
    """
    declared = _declared_module(record, imported)
    if not declared:
        return []
    destinations = list(modules.get(declared, []))
    # 保留 from . import 子模块规则；普通 from 包 import 符号只指向包。
    # 不使用符号最终定义，避免把包的重导出错误画成跨层直接导入。
    if imported.get("level") and not imported.get("module"):
        for item in imported.get("names", []):
            name = item if isinstance(item, str) else item["name"]
            destinations.extend(modules.get(f"{declared}.{name}", []))
    return list(dict.fromkeys(destinations))


def _module_graph(snapshot: dict) -> tuple[dict, dict]:
    """构建导入依赖，区分声明模块和重导出后的符号定义。

    Args:
        snapshot (dict): 分析索引。

    Returns:
        tuple[dict, dict]: 全部文件节点及聚合导入关系。
    """
    nodes = {
        file_id: _file_node(record) for file_id, record in snapshot["files"].items()
    }
    modules: dict[str, list[str]] = {}
    for file_id, record in snapshot["files"].items():
        modules.setdefault(record["module"], []).append(file_id)
    edges: dict[str, dict] = {}
    for file_id, record in snapshot["files"].items():
        for imported in record.get("imports", []):
            declared = _declared_module(record, imported)
            destinations = _import_destinations(record, imported, modules)
            if destinations:
                for destination in dict.fromkeys(destinations):
                    _append_edge(
                        edges,
                        "import",
                        file_id,
                        destination,
                        imported["id"],
                        "ambiguous" if len(set(destinations)) > 1 else "resolved",
                    )
            else:
                label = declared or imported.get("expression", "未解析导入")
                node_id = (
                    "import:" + hashlib.sha256(label.encode("utf-8")).hexdigest()[:20]
                )
                namespace = bool(declared) and any(
                    name.startswith(declared + ".") for name in modules
                )
                nodes.setdefault(
                    node_id,
                    {
                        "id": node_id,
                        "label": label,
                        "kind": "namespace" if namespace else "external",
                        "file_id": None,
                        "entity_id": None,
                        "module": declared,
                        "scope": "project" if namespace else "external",
                        "message_code": (
                            "graph.namespace" if namespace else "graph.external_import"
                        ),
                        "params": {},
                        "description": (
                            "命名空间包，没有独立的模块源码文件。"
                            if namespace
                            else "项目外或未解析的导入模块。"
                        ),
                        "targets": imported.get("targets", []),
                    },
                )
                _append_edge(
                    edges,
                    "import",
                    file_id,
                    node_id,
                    imported["id"],
                    imported.get("status", "pending"),
                )
    return nodes, edges


def _call_graph(snapshot: dict) -> tuple[dict, dict]:
    """生成含未解析调用位置的完整显式调用图。

    Args:
        snapshot (dict): 分析索引。

    Returns:
        tuple[dict, dict]: 调用节点和聚合关系。
    """
    nodes = {
        entity_id: _entity_node(snapshot, entity)
        for entity_id, entity in snapshot["entities"].items()
        if entity["kind"] in {"module", "class", "function", "method", "lambda"}
    }
    edges: dict[str, dict] = {}
    for call_id, call in snapshot["calls"].items():
        owner_id = call["owner_id"]
        if owner_id not in nodes:
            continue
        targets = call.get("targets", [])
        if not targets:
            unknown_id = f"unresolved:{call_id}"
            nodes[unknown_id] = {
                "id": unknown_id,
                "label": call.get("callee", "未知调用"),
                "kind": "unresolved",
                "name": call.get("callee", ""),
                "qualname": call.get("callee", ""),
                "parent_id": None,
                "range": None,
                "relative_path": "",
                "file_id": None,
                "entity_id": None,
                "module": "",
                "scope": "unresolved",
                "call_id": call_id,
                "status": call.get("status", "pending"),
                "description": call.get("reason", ""),
                "message_code": call.get("message_code", ""),
                "params": call.get("params", {}),
            }
            _append_edge(
                edges,
                "call",
                owner_id,
                unknown_id,
                call_id,
                call.get("status", "pending"),
            )
        for target in targets:
            node = _target_node(snapshot, target)
            nodes[node["id"]] = node
            _append_edge(
                edges,
                "call",
                owner_id,
                node["id"],
                call_id,
                call.get("status", "pending"),
            )
    return nodes, edges


def _reference_graph(snapshot: dict) -> tuple[dict, dict]:
    """聚合已经按源码位置解析的跨文件符号使用。

    Args:
        snapshot (dict): 分析索引。

    Returns:
        tuple[dict, dict]: 文件与外部符号节点及引用关系。
    """
    nodes = {
        file_id: _file_node(record) for file_id, record in snapshot["files"].items()
    }
    edges: dict[str, dict] = {}
    for reference_id, reference in snapshot["references"].items():
        if reference.get("kind") == "import":
            continue
        for target in reference.get("targets", []):
            target_file = target.get("file_id")
            if target_file == reference["file_id"]:
                continue
            if target_file in nodes:
                node_id = target_file
            else:
                node = _target_node(snapshot, target)
                node_id = node["id"]
                nodes[node_id] = node
            _append_edge(
                edges,
                "reference",
                reference["file_id"],
                node_id,
                reference_id,
                reference.get("status", "pending"),
            )
    return nodes, edges


def _focused_nodes(
    nodes: dict,
    edges: dict,
    seeds: set[str],
    direction: str,
    depth: int,
) -> set[str]:
    """按上下游方向选择有限深度的可见关系。

    Args:
        nodes (dict): 全部节点。
        edges (dict): 全部关系。
        seeds (set[str]): 焦点节点集合。
        direction (str): incoming、outgoing 或 both。
        depth (int): 展开的关系层数。

    Returns:
        set[str]: 焦点与指定深度内的节点标识。
    """
    adjacency = {node_id: set() for node_id in nodes}
    for edge in edges.values():
        source, target = edge["source"], edge["target"]
        if direction in {"outgoing", "both"}:
            adjacency[source].add(target)
        if direction in {"incoming", "both"}:
            adjacency[target].add(source)
    seen = set(seeds)
    queue = deque((seed, 0) for seed in seeds)
    while queue:
        current, distance = queue.popleft()
        if distance >= depth:
            continue
        for target in adjacency[current]:
            if target not in seen:
                seen.add(target)
                queue.append((target, distance + 1))
    return seen


def _call_hierarchy(
    snapshot: dict,
    raw_nodes: dict,
    loaded_ids: list[str],
    focus_file: str | None,
) -> tuple[list[dict], list[dict]]:
    """为已加载事实补齐文件、作用域和必要祖先定义首行。

    Args:
        snapshot (dict): 不变的源码定义与所属关系。
        raw_nodes (dict): 原始调用事实节点。
        loaded_ids (list[str]): 当前分页实际加载的事实标识。
        focus_file (str | None): 当前中心文件，可在没有成员时显示标题。

    Returns:
        tuple[list[dict], list[dict]]: 事实行与独立包含容器。
    """
    visible = {
        node_id: {**raw_nodes[node_id], "context_only": False} for node_id in loaded_ids
    }
    scope_ids = set()
    # 祖先只提供结构，不借此扩大函数调用的深度或消耗成员配额。
    for node_id in loaded_ids:
        entity = snapshot["entities"].get(node_id)
        if entity is None:
            continue
        if entity["kind"] == "class":
            scope_ids.add(node_id)
        parent_id = entity["parent_id"]
        while parent_id is not None:
            parent = snapshot["entities"][parent_id]
            if parent["kind"] in {"class", "function", "method", "lambda"}:
                scope_ids.add(parent_id)
                if parent_id not in visible:
                    visible[parent_id] = {**raw_nodes[parent_id], "context_only": True}
            parent_id = parent["parent_id"]

    containers = {}

    def file_container(file_id: str) -> str:
        """建立一个已显示文件的包含容器。

        Args:
            file_id (str): 已扫描文件标识。

        Returns:
            str: 与事实节点身份分离的文件容器标识。
        """
        container_id = f"container:file:{file_id}"
        if container_id not in containers:
            record = snapshot["files"][file_id]
            containers[container_id] = {
                "id": container_id,
                "kind": "file_container",
                "file_id": file_id,
                "entity_id": None,
                "parent": None,
                "label": Path(record["path"]).name,
                "name": Path(record["path"]).name,
                "relative_path": record["relative_path"],
                "module": record["module"],
                "range": record.get("range"),
                "scope": "project",
            }
        return container_id

    def ancestor_container(entity: dict) -> str:
        """查找定义行最近的真实父作用域容器。

        Args:
            entity (dict): 当前定义实体。

        Returns:
            str: 最近作用域容器或所属文件容器。
        """
        parent_id = entity["parent_id"]
        while parent_id is not None:
            if parent_id in scope_ids:
                return scope_container(parent_id)
            parent_id = snapshot["entities"][parent_id]["parent_id"]
        return file_container(entity["file_id"])

    def scope_container(entity_id: str) -> str:
        """建立类或包含可见嵌套定义的函数作用域容器。

        Args:
            entity_id (str): 真实作用域定义标识。

        Returns:
            str: 该作用域的独立包含容器标识。
        """
        container_id = f"container:scope:{entity_id}"
        if container_id not in containers:
            entity = snapshot["entities"][entity_id]
            parent = ancestor_container(entity)
            record = snapshot["files"][entity["file_id"]]
            containers[container_id] = {
                "id": container_id,
                "kind": "scope_container",
                "scope_kind": entity["kind"],
                "entity_id": entity_id,
                "file_id": entity["file_id"],
                "parent": parent,
                "label": entity["name"],
                "name": entity["name"],
                "qualname": entity["qualname"],
                "range": entity["range"],
                "relative_path": record["relative_path"],
                "module": record["module"],
                "scope": "project",
            }
        return container_id

    if focus_file is not None:
        file_container(focus_file)
    for node_id, node in visible.items():
        entity = snapshot["entities"].get(node_id)
        if entity is not None:
            node["parent"] = (
                scope_container(node_id)
                if node_id in scope_ids
                else ancestor_container(entity)
            )
        elif node.get("file_id") in snapshot["files"]:
            node["parent"] = file_container(node["file_id"])
        else:
            unresolved = node.get("kind") == "unresolved"
            category = "unresolved" if unresolved else "external"
            container_id = f"container:boundary:{category}"
            containers.setdefault(
                container_id,
                {
                    "id": container_id,
                    "kind": "boundary_container",
                    "parent": None,
                    "file_id": None,
                    "entity_id": None,
                    "label": "未解析调用" if unresolved else "文件外调用",
                    "message_code": (
                        "graph.unresolvedCalls" if unresolved else "graph.externalCalls"
                    ),
                    "params": {},
                    "scope": category,
                },
            )
            node["parent"] = container_id

    totals = Counter(node.get("file_id") for node in raw_nodes.values())
    displayed = Counter(node.get("file_id") for node in visible.values())
    for container in containers.values():
        if container["kind"] != "file_container":
            continue
        file_id = container["file_id"]
        total = totals[file_id]
        shown = displayed[file_id]
        container.update(
            member_total=total,
            member_shown=shown,
            remaining_members=max(0, total - shown),
        )
    return list(visible.values()), list(containers.values())


def _call_projection(
    snapshot: dict,
    raw_nodes: dict,
    raw_edges: dict,
    focus: str | None,
    direction: str,
    depth: int,
    limit: int,
    offset: int,
    internal_only: bool,
) -> dict:
    """保留函数端点，在有向关系范围上加入焦点文件成员上下文。

    Args:
        snapshot (dict): 已提取源码事实。
        raw_nodes (dict): 原始定义及显式边界节点。
        raw_edges (dict): 原始调用关系，不包含包含关系。
        focus (str | None): 中心实体或文件标识。
        direction (str): 原始调用图上的查询方向。
        depth (int): 原始调用关系的层数。
        limit (int): 本批增加的非结构补齐成员数量。
        offset (int): 上批已加载的成员数。
        internal_only (bool): 是否只加载项目内事实节点。

    Returns:
        dict: 层级调用图、分页进度、结构计数和范围说明。
    """
    nodes = {
        key: node
        for key, node in raw_nodes.items()
        if not internal_only or node.get("scope") == "project"
    }
    edges = {
        key: edge
        for key, edge in raw_edges.items()
        if edge["source"] in nodes and edge["target"] in nodes
    }
    focus_file = None
    if focus in snapshot["files"]:
        focus_file = focus
    elif focus in snapshot["entities"]:
        focus_file = snapshot["entities"][focus]["file_id"]
    elif focus in nodes:
        focus_file = nodes[focus].get("file_id")
    seeds = {
        node_id
        for node_id, node in nodes.items()
        if focus and focus in {node_id, node.get("file_id"), node.get("entity_id")}
    }
    if focus:
        related = _focused_nodes(nodes, edges, seeds, direction, max(0, int(depth)))
        context = {
            node_id
            for node_id, node in nodes.items()
            if focus_file is not None and node.get("file_id") == focus_file
        }
        candidates = related | context
    else:
        related = set()
        candidates = set(nodes)

    def order(node_id: str) -> tuple:
        """按中心成员、文件路径及源码位置确定稳定加载顺序。

        Args:
            node_id (str): 候选事实节点标识。

        Returns:
            tuple: 不受名称翻译影响的排序键。
        """
        node = nodes[node_id]
        record = snapshot["files"].get(node.get("file_id"), {})
        return (
            node_id not in seeds,
            focus_file is not None and node.get("file_id") != focus_file,
            node.get("file_id") not in snapshot["files"],
            record.get("relative_path", node.get("module", "")),
            (node.get("range") or {}).get("from", 0),
            node["label"],
            node_id,
        )

    ordered = sorted(candidates, key=order)
    begin = max(0, int(offset))
    maximum = max(1, int(limit))
    loaded = ordered[: begin + maximum]
    shown_nodes, containers = _call_hierarchy(snapshot, raw_nodes, loaded, focus_file)
    visible = {node["id"] for node in shown_nodes}
    shown_edges = [
        edge
        for edge in raw_edges.values()
        if edge["source"] in visible and edge["target"] in visible
    ]
    hidden_edges = sum(
        (edge["source"] in visible) != (edge["target"] in visible)
        for edge in raw_edges.values()
    )
    remaining = max(0, len(ordered) - len(loaded))
    return {
        "kind": "call",
        "nodes": shown_nodes,
        "containers": containers,
        "edges": shown_edges,
        "focus": focus,
        "focus_ids": sorted(seeds),
        "related_ids": sorted(related),
        "hidden_edges": hidden_edges,
        "total": len(ordered),
        "shown": len(loaded),
        "remaining": remaining,
        "offset": begin,
        "next_offset": len(loaded) if remaining else None,
        "filtered": len(raw_nodes) - len(nodes),
    }


def graph(
    snapshot: dict,
    kind: str = "module",
    focus: str | None = None,
    direction: str = "both",
    depth: int = 1,
    limit: int = 150,
    offset: int = 0,
    internal_only: bool = False,
) -> dict:
    """生成层级调用图或保留原有规则的文件和引用图。

    Args:
        snapshot (dict): 完整源码事实及关系。
        kind (str): module、call 或 reference。
        focus (str | None): 当前关注的实体或文件。
        direction (str): 入边、出边或双向。
        depth (int): 从中心扩展的调用或依赖层数。
        limit (int): 本批加载的非结构补齐事实数量。
        offset (int): 继续加载位置，返回累计图。
        internal_only (bool): 是否仅加载项目内目标。

    Returns:
        dict: 事实节点、关系、范围及调用图包含容器。

    Raises:
        ValueError: 图类型或方向非法。
    """
    if direction not in {"incoming", "outgoing", "both"}:
        raise coded_error(
            ValueError,
            "graph.invalid_direction",
            "图方向只能为 incoming、outgoing 或 both。",
        )
    builders = {
        "module": _module_graph,
        "call": _call_graph,
        "reference": _reference_graph,
    }
    if kind not in builders:
        raise coded_error(
            ValueError,
            "graph.invalid_kind",
            "图类型只能为 module、call 或 reference。",
        )
    nodes, edges = builders[kind](snapshot)
    if kind == "call":
        return _call_projection(
            snapshot,
            nodes,
            edges,
            focus,
            direction,
            depth,
            limit,
            offset,
            internal_only,
        )
    all_count = len(nodes)
    if internal_only:
        nodes = {
            key: value
            for key, value in nodes.items()
            if value.get("scope") == "project"
        }
        edges = {
            key: edge
            for key, edge in edges.items()
            if edge["source"] in nodes and edge["target"] in nodes
        }
    seeds = set()
    if focus:
        seeds = {
            node_id
            for node_id, node in nodes.items()
            if focus in {node_id, node.get("file_id"), node.get("entity_id")}
        }
        selected = _focused_nodes(nodes, edges, seeds, direction, max(0, int(depth)))
        nodes = {key: nodes[key] for key in selected}
    ordered = sorted(
        nodes,
        key=lambda key: (
            key not in seeds,
            nodes[key].get("module", ""),
            nodes[key]["label"],
            key,
        ),
    )
    begin = max(0, int(offset))
    maximum = max(1, int(limit))
    shown_ids = ordered[: begin + maximum]
    visible = set(shown_ids)
    shown_edges = [
        edge
        for edge in edges.values()
        if edge["source"] in visible and edge["target"] in visible
    ]
    remaining = max(0, len(ordered) - len(shown_ids))
    return {
        "kind": kind,
        "nodes": [nodes[key] for key in shown_ids],
        "edges": shown_edges,
        "remaining": remaining,
        "total": len(ordered),
        "offset": begin,
        "next_offset": len(shown_ids) if remaining else None,
        "shown": len(shown_ids),
        "filtered": all_count - len(nodes) if internal_only else 0,
        "reference_index": snapshot.get("reference_index", {}),
    }
