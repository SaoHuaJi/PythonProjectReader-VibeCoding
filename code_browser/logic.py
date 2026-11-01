"""根据源码嵌套结构生成内部逻辑视图，不求解实际执行轨迹。"""

from __future__ import annotations

import ast

from .models import make_id
from .source import SourceMap


def logic_id(file_id: str, owner_id: str, start: int) -> str:
    """生成语句结构和调用位置共享的关联标识。

    Args:
        file_id (str): 文件标识。
        owner_id (str): 当前执行作用域标识。
        start (int): 语句的 UTF-16 起始偏移。

    Returns:
        str: 当前作用域语句的唯一关联标识。
    """
    return make_id("logic", file_id, owner_id, start)


class LogicBuilder:
    """将一个作用域的语句转换为可展开源码结构的构造对象。

    属性:
        source: 原文及其统一位置映射。
        file_id: 结构所属文件标识。
        owner_id: 当前执行作用域标识。
        calls_by_logic: 各源码语句包含的显式调用位置。
    """

    def __init__(
        self,
        source: SourceMap,
        file_id: str,
        owner_id: str,
        calls: dict,
    ) -> None:
        """保存结构构造所需的源文与调用索引。

        Args:
            source (SourceMap): 原文位置映射。
            file_id (str): 当前文件标识。
            owner_id (str): 当前作用域实体标识。
            calls (dict): 全部已提取的调用位置。

        Returns:
            None: 初始化构造对象。
        """
        self.source = source
        self.file_id = file_id
        self.owner_id = owner_id
        # 每个调用预先关联所在语句，避免把子块调用重复计入头部。
        self.calls_by_logic: dict[str, list[str]] = {}
        for call in calls.values():
            if call["owner_id"] == owner_id:
                self.calls_by_logic.setdefault(call["logic_id"], []).append(call["id"])

    def block(
        self,
        body: list[ast.AST],
        loops: tuple = (),
        finalizers: tuple = (),
    ) -> list[dict]:
        """按源码顺序构造语句区块。

        Args:
            body (list[ast.AST]): 当前区块的语句或表达式。
            loops (tuple): 外层循环及其 finally 深度。
            finalizers (tuple): 当前关联的外层 finally 源码范围。

        Returns:
            list[dict]: 保留嵌套结构的语句列表。
        """
        return [self.node(statement, loops, finalizers) for statement in body]

    def node(
        self,
        statement: ast.AST,
        loops: tuple,
        finalizers: tuple,
    ) -> dict:
        """构造一个语句及其分支、子块和显式转移。

        Args:
            statement (ast.AST): 当前语句或表达式。
            loops (tuple): 外层循环上下文。
            finalizers (tuple): 外层 finally 结构范围。

        Returns:
            dict: 可序列化的内部逻辑节点。
        """
        source_range = self.source.range_of(statement)
        node_id = logic_id(self.file_id, self.owner_id, source_range["from"])
        kind = {
            "AsyncFor": "async_for",
            "AsyncWith": "async_with",
            "TryStar": "try_star",
            "YieldFrom": "yield_from",
        }.get(type(statement).__name__, type(statement).__name__.lower())
        raw = self.source.slice(statement)
        label = raw.splitlines()[0] if raw else kind
        result = {
            "id": node_id,
            "kind": kind,
            "label": label,
            "range": source_range,
            "calls": self.calls_by_logic.get(node_id, []),
            "branches": [],
            "children": [],
            "transfer": None,
        }
        # 条件及循环主体保持独立，循环 else 只描述自然结束。
        if isinstance(statement, ast.If):
            result["label"] = "if " + self.source.slice(statement.test)
            result["branches"] = [
                self._branch(
                    "条件成立", statement.body, loops, finalizers, "branch.if_true"
                )
            ]
            if statement.orelse:
                result["branches"].append(
                    self._branch(
                        "否则", statement.orelse, loops, finalizers, "branch.else"
                    )
                )
        elif isinstance(statement, (ast.For, ast.AsyncFor, ast.While)):
            if isinstance(statement, ast.While):
                result["label"] = "while " + self.source.slice(statement.test)
            else:
                prefix = "async for" if isinstance(statement, ast.AsyncFor) else "for"
                result["label"] = (
                    f"{prefix} {self.source.slice(statement.target)}"
                    f" in {self.source.slice(statement.iter)}"
                )
            nested_loops = loops + ((source_range, len(finalizers)),)
            result["branches"] = [
                self._branch(
                    "循环体", statement.body, nested_loops, finalizers, "branch.loop"
                )
            ]
            if statement.orelse:
                result["branches"].append(
                    self._branch(
                        "自然结束（未 break）",
                        statement.orelse,
                        loops,
                        finalizers,
                        "branch.loop_else",
                    )
                )
        elif isinstance(statement, (ast.Try, ast.TryStar)):
            current_finalizers = finalizers
            if statement.finalbody:
                first = self.source.range_of(statement.finalbody[0])
                last = self.source.range_of(statement.finalbody[-1])
                final_range = {
                    **first,
                    "to": last["to"],
                    "end_line": last["end_line"],
                }
                current_finalizers += (final_range,)
            result["branches"].append(
                self._branch(
                    "try 主体", statement.body, loops, current_finalizers, "branch.try"
                )
            )
            for handler in statement.handlers:
                title = "except"
                if isinstance(statement, ast.TryStar):
                    title += "*"
                if handler.type is not None:
                    title += " " + self.source.slice(handler.type)
                if handler.name:
                    title += " as " + handler.name
                result["branches"].append(
                    self._branch(title, handler.body, loops, current_finalizers)
                )
            if statement.orelse:
                result["branches"].append(
                    self._branch(
                        "else（主体正常完成）",
                        statement.orelse,
                        loops,
                        current_finalizers,
                        "branch.try_else",
                    )
                )
            if statement.finalbody:
                result["branches"].append(
                    self._branch(
                        "finally（离开时执行）",
                        statement.finalbody,
                        loops,
                        finalizers,
                        "branch.finally",
                    )
                )
        elif isinstance(statement, ast.Match):
            result["label"] = "match " + self.source.slice(statement.subject)
            for case in statement.cases:
                title = "case " + self.source.slice(case.pattern)
                if case.guard:
                    title += " if " + self.source.slice(case.guard)
                result["branches"].append(
                    self._branch(title, case.body, loops, finalizers)
                )
        elif isinstance(statement, (ast.With, ast.AsyncWith)):
            result["branches"] = [
                self._branch(
                    "上下文主体", statement.body, loops, finalizers, "branch.with"
                )
            ]
        elif isinstance(statement, (ast.Break, ast.Continue)):
            loop = loops[-1] if loops else None
            result["transfer"] = {
                "kind": kind,
                "target": loop[0] if loop else None,
                "finally": list(finalizers[loop[1] :]) if loop else [],
            }
        elif isinstance(statement, (ast.Return, ast.Raise)):
            result["transfer"] = {
                "kind": kind,
                "target": None,
                "finally": list(finalizers),
                "note": "关联 finally；最终转移仍以源码结构为准",
                "message_code": "logic.finally_note",
                "params": {},
            }
        elif isinstance(statement, ast.Expr):
            value = statement.value
            if isinstance(value, (ast.Yield, ast.YieldFrom, ast.Await)):
                result["kind"] = (
                    "yield_from"
                    if isinstance(value, ast.YieldFrom)
                    else type(value).__name__.lower()
                )
                result["transfer"] = {
                    "kind": result["kind"],
                    "target": None,
                    "finally": [],
                }
        return result

    def _branch(
        self,
        label: str,
        body: list,
        loops: tuple,
        finalizers: tuple,
        message_code: str = "branch.source",
    ) -> dict:
        """构造具名语句子块。

        Args:
            label (str): 分支或处理区块的原文语义标签。
            message_code (str): 应用标签代码；源码分支保持原文。
            body (list): 区块中的语句。
            loops (tuple): 当前循环上下文。
            finalizers (tuple): 当前 finally 上下文。

        Returns:
            dict: 标签与内部节点组成的区块。
        """
        return {
            "label": label,
            "message_code": message_code,
            "params": {"text": label} if message_code == "branch.source" else {},
            "nodes": self.block(body, loops, finalizers),
        }


def build_logic(
    body: list[ast.AST],
    source: SourceMap,
    file_id: str,
    owner_id: str,
    calls: dict,
) -> list[dict]:
    """为模块、类或函数构造内部源码结构。

    Args:
        body (list[ast.AST]): 当前作用域的语句。
        source (SourceMap): 原文位置映射。
        file_id (str): 文件标识。
        owner_id (str): 作用域实体标识。
        calls (dict): 已提取调用位置索引。

    Returns:
        list[dict]: 可展开的内部逻辑节点。
    """
    return LogicBuilder(source, file_id, owner_id, calls).block(body)
