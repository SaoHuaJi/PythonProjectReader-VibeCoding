"""借助 Jedi 静态查询名称、类型与调用候选，不导入目标项目。"""

from __future__ import annotations

import hashlib
import io
import os
import sys
import tokenize
from pathlib import Path
from typing import Callable

import jedi

from .messages import coded_error
from .source import SourceMap, read_source


class SnapshotChanged(RuntimeError):
    """表示磁盘源码与本次分析原文不一致，必须重新分析。"""


def _canonical(path: str | Path) -> str:
    """规范化路径以匹配同一个源码文件。

    Args:
        path (str | Path): 源码路径。

    Returns:
        str: 绝对、大小写规范化的路径。
    """
    return os.path.normcase(str(Path(path).resolve()))


def _within(path: str | Path, root: str | Path) -> bool:
    """判断路径是否处于指定读取目录内。

    Args:
        path (str | Path): 待判断路径。
        root (str | Path): 允许读取的目录。

    Returns:
        bool: 是否为目录本身或其后代。
    """
    return Path(_canonical(path)).is_relative_to(Path(_canonical(root)))


def _result(
    targets: list[dict],
    reason: str = "",
    message_code: str = "",
    params: dict | None = None,
) -> dict:
    """将候选整理为明确的静态查询结果。

    Args:
        targets (list[dict]): 定义候选。
        reason (str): 无结果或特殊情况说明。
        message_code (str): 对应前端语言字典的说明标识。
        params (dict | None): 模板中的原始名称、路径或错误证据。

    Returns:
        dict: 状态、去重后的候选及说明。
    """
    unique = {target["id"]: target for target in targets}
    items = list(unique.values())
    status = "resolved" if len(items) == 1 else "ambiguous"
    if not items:
        status = "unresolved"
        reason = reason or "静态分析未能确定目标，保留源码表达式。"
        message_code = message_code or "resolve.unknown"
    return {
        "targets": items,
        "status": status,
        "reason": reason,
        "message_code": message_code,
        "params": params or {},
    }


class Resolver:
    """持有一个项目的静态名称查询上下文。

    属性:
        snapshot: 本次分析的原文与结构索引。
        options: 明确设置的源码根、依赖目录等选项。
        project: 只用于静态查找的 Jedi 项目。
        environment: 工具自身可信 Python 环境。
        scripts: 按文件缓存的静态查询对象。
        maps: 原文到网页位置的映射。
        paths: 规范路径到文件标识的映射。
        definitions: 文件、名称位置和原名到定义的直接索引。
        lambda_positions: 匿名函数定义起点的直接索引。
        tokens: 按文件缓存的词法位置，仅用于精确定位导入名称。
        queries: 当前原文中的已完成查询缓存。
        allowed_roots: 可显示外部源码的明确读取范围。
        dependency_paths: 以目标项目为基准规范化的依赖源码目录。
    """

    def __init__(
        self,
        snapshot: dict,
        options: dict | None = None,
        cache_dir: str | Path | None = None,
    ) -> None:
        """初始化不执行目标代码的静态查询环境。

        Args:
            snapshot (dict): 已提取的项目原文和实体。
            options (dict | None): 源码和只读依赖目录。
            cache_dir (str | Path | None): 工具自己的缓存目录。

        Returns:
            None: 原位建立查询上下文。
        """
        self.snapshot = snapshot
        self.options = options or {}
        self.scripts: dict[str, jedi.Script] = {}
        self.maps: dict[str, SourceMap] = {}
        self.tokens: dict[str, list] = {}
        self.queries: dict[tuple, dict] = {}
        self.paths = {
            _canonical(item["path"]): file_id
            for file_id, item in snapshot["files"].items()
        }

        # 本次实体集合在解析阶段保持不变，避免每次查询遍历全部定义。
        self.definitions = {
            (
                entity["file_id"],
                entity.get("name_range", entity["range"])["from"],
                entity["name"],
            ): entity
            for entity in snapshot["entities"].values()
        }
        self.lambda_positions = {
            (
                entity["file_id"],
                entity.get("name_range", entity["range"])["from"],
            ): entity
            for entity in snapshot["entities"].values()
            if entity["kind"] == "lambda"
        }

        # 搜索路径只交给 Jedi，不注入工具进程的实际 sys.path。
        jedi.settings.auto_import_modules = []
        if cache_dir is not None:
            Path(cache_dir).mkdir(parents=True, exist_ok=True)
            jedi.settings.cache_directory = str(Path(cache_dir).resolve())
        self.environment = jedi.create_environment(sys.executable, safe=True)
        base_paths = [
            value
            for value in self.environment.get_sys_path()
            if value and (_within(value, sys.prefix) or _within(value, sys.base_prefix))
        ]
        roots = snapshot["import_roots"]
        project_root = Path(snapshot["root"])
        # 相对依赖路径与源码根一样，以选定项目为基准而非工具工作目录。
        self.dependency_paths = [
            str(
                (
                    Path(value) if Path(value).is_absolute() else project_root / value
                ).resolve()
            )
            for value in self.options.get("dependency_paths", [])
        ]
        search_paths = list(
            dict.fromkeys(
                str(Path(value).resolve())
                for value in [*roots, *self.dependency_paths, *base_paths]
            )
        )
        self.project = jedi.Project(
            snapshot["root"],
            environment_path=sys.executable,
            sys_path=search_paths,
            smart_sys_path=False,
            load_unsafe_extensions=False,
        )
        self.allowed_roots = [
            *snapshot["source_roots"],
            *self.dependency_paths,
            *base_paths,
        ]

    def assert_current(self, file_id: str | None = None) -> None:
        """检查磁盘文件仍与分析时的原文一致。

        Args:
            file_id (str | None): 指定文件；为空则检查整个项目。

        Returns:
            None: 一致时不返回值，变化时抛出 SnapshotChanged。
        """
        records = self.snapshot["files"]
        files = [records[file_id]] if file_id else records.values()
        for record in files:
            if record.get("parse_status") == "unreadable":
                continue
            try:
                current_hash = read_source(record["path"])[2]
            except (OSError, UnicodeError, SyntaxError) as exc:
                raise coded_error(
                    SnapshotChanged,
                    "resolve.source_unreadable",
                    f"源码无法再次读取：{record['relative_path']}；{exc}",
                    path=record["relative_path"],
                    error=str(exc),
                ) from exc
            if current_hash != record["hash"]:
                raise coded_error(
                    SnapshotChanged,
                    "resolve.source_changed",
                    f"源码已变化：{record['relative_path']}，请重新分析。",
                    path=record["relative_path"],
                )

    def _script(self, file_id: str) -> jedi.Script:
        """取得当前文件的静态查询对象。

        Args:
            file_id (str): 文件标识。

        Returns:
            jedi.Script: 使用分析原文的查询对象。
        """
        if file_id not in self.scripts:
            record = self.snapshot["files"][file_id]
            self.scripts[file_id] = jedi.Script(
                code=record["source"],
                path=record["path"],
                project=self.project,
                environment=self.environment,
            )
        return self.scripts[file_id]

    def _map(self, file_id: str) -> SourceMap:
        """取得文件的统一位置转换对象。

        Args:
            file_id (str): 文件标识。

        Returns:
            SourceMap: 对应分析原文的位置转换。
        """
        if file_id not in self.maps:
            self.maps[file_id] = SourceMap(self.snapshot["files"][file_id]["source"])
        return self.maps[file_id]

    def _entity_at(self, name, file_id: str | None) -> dict | None:
        """按定义位置匹配本地实体，避免同名误连接。

        Args:
            name (jedi.api.classes.Name): Jedi 定义候选。
            file_id (str | None): 所属项目文件。

        Returns:
            dict | None: 匹配的实体，或无法匹配时为空。
        """
        if file_id is None:
            return None
        record = self.snapshot["files"][file_id]
        if name.type == "module":
            return self.snapshot["entities"].get(record.get("module_id"))
        if name.line is None or name.column is None:
            return None
        offset = self._map(file_id).point(name.line, name.column)
        entity = self.definitions.get((file_id, offset, name.name))
        if entity is not None:
            return entity
        return self.lambda_positions.get((file_id, offset))

    def _name_target(self, name, preview: bool = False) -> dict:
        """将 Jedi 候选转为可传输、可导航的数据。

        Args:
            name (jedi.api.classes.Name): 静态查询返回的候选。
            preview (bool): 是否读取允许范围内的外部源码。

        Returns:
            dict: 定义、所属范围及可选源码预览。
        """
        path = str(name.module_path) if name.module_path else None
        file_id = self.paths.get(_canonical(path)) if path else None
        entity = self._entity_at(name, file_id)
        builtin = name.in_builtin_module()
        scope = "project" if file_id else "external"
        if builtin:
            scope = "builtin"
        elif (
            path
            and not file_id
            and any(_within(path, root) for root in self.dependency_paths)
        ):
            scope = "dependency"
        identity = (
            entity["id"]
            if entity
            else f"{path}:{name.line}:{name.column}:{name.type}:{name.name}"
        )
        target = {
            "id": entity["id"]
            if entity
            else (
                "target:" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:20]
            ),
            "entity_id": entity["id"] if entity else None,
            "file_id": file_id,
            "name": name.name or "",
            "qualname": entity["qualname"]
            if entity
            else (name.full_name or name.name or ""),
            "module": self.snapshot["files"][file_id]["module"]
            if file_id
            else name.module_name,
            "kind": entity["kind"] if entity else name.type,
            "path": path,
            "line": name.line,
            "range": entity["range"] if entity else None,
            "scope": scope,
            "source": "jedi",
        }
        if not preview or entity:
            return target

        # 外部实现只读取已声明的源码范围，二进制实现不尝试导入。
        if (
            path
            and Path(path).suffix.lower() in {".py", ".pyi"}
            and any(_within(path, root) for root in self.allowed_roots)
        ):
            try:
                text, encoding, _ = read_source(path)
                source_map = SourceMap(text)
                start = name.get_definition_start_position()
                end = name.get_definition_end_position()
                if start and end:
                    span = source_map.span(*start, *end)
                else:
                    row = name.line or 1
                    col = name.column or 0
                    span = source_map.span(row, col, row, col + len(name.name or ""))
                target["range"] = span
                target["preview"] = {
                    "source": text,
                    "path": path,
                    "range": span,
                    "encoding": encoding,
                }
                target["docstring"] = name.docstring(raw=True)
            except (OSError, UnicodeError, SyntaxError, ValueError) as exc:
                target["preview_reason"] = f"外部源码不可读取：{exc}"
                target["message_code"] = "resolve.preview_failed"
                target["params"] = {"error": str(exc)}
        else:
            target["preview_reason"] = "没有可显示的 Python 源码或存根。"
            target["message_code"] = "resolve.preview_missing"
            target["params"] = {}
        return target

    def _query(
        self,
        file_id: str,
        line: int,
        column: int,
        mode: str,
        preview: bool = False,
    ) -> dict:
        """在准确名称位置执行一次静态查询。

        Args:
            file_id (str): 文件标识。
            line (int): 从一开始的源码行。
            column (int): 从零开始的 Unicode 字符列。
            mode (str): binding 查询绑定，type 查询最终定义。
            preview (bool): 是否附外部源码。

        Returns:
            dict: 静态候选和查询状态。
        """
        key = (file_id, line, column, mode, preview)
        if key in self.queries:
            return self.queries[key]
        try:
            script = self._script(file_id)
            if mode == "binding":
                names = script.goto(
                    line,
                    column,
                    follow_imports=True,
                    follow_builtin_imports=False,
                )
            else:
                names = script.infer(line, column)
            result = _result(
                [self._name_target(name, preview=preview) for name in names]
            )
        except (ValueError, AttributeError, KeyError, OSError) as exc:
            result = {
                "targets": [],
                "status": "error",
                "reason": f"名称查询失败：{type(exc).__name__}: {exc}",
                "message_code": "resolve.query_failed",
                "params": {"error": f"{type(exc).__name__}: {exc}"},
            }
        self.queries[key] = result
        return result

    def resolve_call(self, call: dict) -> dict:
        """解析一次显式调用的静态目标，不求取运行结果。

        Args:
            call (dict): 提取器记录的调用位置及原表达式。

        Returns:
            dict: 被调候选、解析状态和原因。
        """
        file_id = call["file_id"]
        self.assert_current(file_id)
        if call.get("callee_kind", "name") not in {"name", "attribute"}:
            return _result(
                [],
                "被调表达式不是直接名称或属性，保留调用位置。",
                "resolve.opaque",
            )
        result = self._query(file_id, call["line"], call["column"], "type")
        self.assert_current(file_id)
        for target in result["targets"]:
            if target.get("file_id"):
                self.assert_current(target["file_id"])
        return result

    def definition(self, file_id: str, offset: int, mode: str = "binding") -> dict:
        """从源码点击位置查询变量绑定或最终定义。

        Args:
            file_id (str): 项目文件标识。
            offset (int): 网页使用的 UTF-16 绝对偏移。
            mode (str): binding 为绑定位置，type 为类型/最终定义。

        Returns:
            dict: 定义候选和可选外部源码。
        """
        if mode not in {"binding", "type"}:
            raise coded_error(
                ValueError,
                "resolve.invalid_mode",
                "查询方式只能是 binding 或 type。",
            )
        self.assert_current()
        line, column = self._map(file_id).position(offset)
        result = self._query(file_id, line, column, mode, preview=True)
        self.assert_current()
        return result

    def _import_positions(self, file_id: str, record: dict) -> list:
        """找到导入名称或其别名的精确字符位置。

        Args:
            file_id (str): 所在文件。
            record (dict): 导入语句记录。

        Returns:
            list[tuple[int, int]]: 名称查询位置。
        """
        if file_id not in self.tokens:
            self.tokens[file_id] = list(
                tokenize.generate_tokens(
                    io.StringIO(self.snapshot["files"][file_id]["source"]).readline
                )
            )
        span = record["range"]
        wanted = set()
        for item in record.get("names", []):
            if isinstance(item, str):
                wanted.add(item.split(".")[-1])
            else:
                wanted.add(item.get("asname") or item.get("name", "").split(".")[-1])
        positions = []
        mapper = self._map(file_id)
        for token in self.tokens[file_id]:
            if token.type != tokenize.NAME or token.string not in wanted:
                continue
            offset = mapper.point(*token.start)
            if span["from"] <= offset < span["to"]:
                positions.append(token.start)
        return positions

    def resolve_imports(self) -> None:
        """解析导入定义并记录外部或未解析边界。

        Args:
            无。

        Returns:
            None: 原位更新每个文件的 imports 记录。
        """
        for file_id, record in self.snapshot["files"].items():
            if record.get("parse_status") not in {"ok", "parsed"}:
                continue
            self.assert_current(file_id)
            for imported in record.get("imports", []):
                targets = []
                errors = []
                error_details = []
                positions = self._import_positions(file_id, imported)
                for line, column in positions:
                    result = self._query(file_id, line, column, "type")
                    targets.extend(result["targets"])
                    if result["status"] == "error":
                        errors.append(result["reason"])
                        error_details.append(result["params"]["error"])
                result = _result(targets)
                if errors and not targets:
                    result["status"] = "error"
                    result["reason"] = "；".join(errors)
                    result["message_code"] = "resolve.query_failed"
                    result["params"] = {"error": "\n".join(error_details)}
                imported.update(result)
            self.assert_current(file_id)

    def index_references(
        self,
        file_id: str | None = None,
        progress: Callable | None = None,
    ) -> dict:
        """逐位置建立显式符号引用索引。

        Args:
            file_id (str | None): 仅索引指定文件；为空索引项目。
            progress (Callable | None): 接收进度字典的回调。

        Returns:
            dict: 已处理数量、总量和目标范围。
        """
        self.assert_current()
        references = [
            reference
            for reference in self.snapshot["references"].values()
            if file_id is None or reference["file_id"] == file_id
        ]
        for number, reference in enumerate(references, 1):
            result = self._query(
                reference["file_id"],
                reference["line"],
                reference["column"],
                "binding",
            )
            reference.update(result)
            if progress:
                progress(
                    {
                        "stage": "references",
                        "processed": number,
                        "total": len(references),
                    }
                )
        self.assert_current()
        result = {
            "processed": len(references),
            "total": len(references),
            "file_id": file_id,
            "status": "ready",
        }
        self.snapshot.setdefault("reference_index", {})[file_id or "project"] = result
        return result
