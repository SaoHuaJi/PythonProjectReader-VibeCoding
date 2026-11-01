"""按词法作用域提取源码事实，不导入或执行目标模块。"""

from __future__ import annotations

import ast
import tokenize

from .logic import build_logic, logic_id
from .models import entity_record, make_id
from .source import SourceMap


class Extractor:
    """记录单份源码的定义、引用、调用和内部结构的分析对象。

    属性:
        snapshot: 当前项目的纯数据容器。
        file: 当前文件的原文与元信息。
        source: 原文位置转换对象。
        scopes: 当前模块、类和函数的词法作用域栈。
        statements: 当前调用所在的语句栈。
        contexts: 当前分支和表达式语义上下文。
        context_messages: 上下文对应的界面语义代码和源码参数。
        declarations: 各作用域的 global/nonlocal 名称声明。
        scope_bindings: 全体语句预收集的词法绑定名，用于后置 nonlocal。
        bodies: 构造结构图之前暂存的语句主体。
        annotation_depth: 非零时只记录注解引用。
    """

    def __init__(self, snapshot: dict, file_record: dict) -> None:
        """建立单文件提取上下文。

        Args:
            snapshot (dict): 本次项目共享的数据容器。
            file_record (dict): 当前源码文件记录。

        Returns:
            None: 初始化只读分析对象。
        """
        self.snapshot = snapshot
        self.file = file_record
        self.source = SourceMap(file_record["source"])
        # scopes 和 statements 分别描述词法归属及调用所在源码语句。
        self.scopes: list[str] = []
        self.statements: list[ast.AST] = []
        self.contexts: list[str] = ["模块顶层"]
        self.context_messages = [{"message_code": "context.module", "params": {}}]
        self.declarations: dict[str, tuple[set, set]] = {}
        self.scope_bindings: dict[str, set[str]] = {}
        self.bodies: dict[str, list[ast.AST]] = {}
        self.annotation_depth = 0

    def extract(self, tree: ast.Module) -> None:
        """提取完整模块，并在全部调用建立后构造内部结构。

        Args:
            tree (ast.Module): 已解析的模块语法树。

        Returns:
            None: 将源码事实写入本次内存容器。
        """
        module = self._entity("module", self.file["module"], tree, parent_id=None)
        self.file["module_id"] = module["id"]
        self.file["docstring"] = ast.get_docstring(tree, clean=False) or ""
        module["docstring"] = self.file["docstring"]
        self.scopes.append(module["id"])
        self._prepare_scope(module["id"], tree.body)
        self.bodies[module["id"]] = tree.body
        self._block(tree.body)
        self.scopes.pop()
        calls_by_owner: dict[str, dict] = {}
        for call in self.snapshot["calls"].values():
            if call["file_id"] == self.file["id"]:
                calls_by_owner.setdefault(call["owner_id"], {})[call["id"]] = call
        for owner_id, body in self.bodies.items():
            self.snapshot["entities"][owner_id]["logic"] = build_logic(
                body,
                self.source,
                self.file["id"],
                owner_id,
                calls_by_owner.get(owner_id, {}),
            )
        # 原始注释独立保留，模块详情只默认展示文件头注释。
        first_code_line = min(
            (getattr(item, "lineno", 1) for item in tree.body),
            default=len(self.source.lines) + 1,
        )
        self.file["comments"] = [
            {
                "text": token.string,
                "range": self.source.span(*token.start, *token.end),
                "kind": "header",
            }
            for token in self.source.comment_tokens
            if token.type == tokenize.COMMENT and token.start[0] < first_code_line
        ]
        module["comments"] = self.file["comments"]
        self._entrypoints(tree)

    def _declarations(self, body: list[ast.AST]) -> tuple[set, set]:
        """收集当前作用域的 global 和 nonlocal 声明。

        Args:
            body (list[ast.AST]): 当前作用域主体。

        Returns:
            tuple[set, set]: 全局绑定名称和外层函数绑定名称。
        """
        global_names: set[str] = set()
        nonlocal_names: set[str] = set()
        pending = list(body)
        while pending:
            node = pending.pop()
            if isinstance(node, ast.Global):
                global_names.update(node.names)
            elif isinstance(node, ast.Nonlocal):
                nonlocal_names.update(node.names)
            elif not isinstance(
                node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda)
            ):
                pending.extend(ast.iter_child_nodes(node))
        return global_names, nonlocal_names

    def _prepare_scope(
        self,
        owner_id: str,
        body: list[ast.AST],
        arguments: ast.arguments | None = None,
    ) -> None:
        """预收集完整词法绑定，避免依赖定义语句的出现顺序。

        Args:
            owner_id (str): 当前模块、类或函数标识。
            body (list[ast.AST]): 当前作用域的完整主体。
            arguments (ast.arguments | None): 函数的参数定义。

        Returns:
            None: 保存本地绑定及 global/nonlocal 声明。
        """
        declarations = self._declarations(body)
        self.declarations[owner_id] = declarations
        bound: set[str] = set()
        if arguments:
            for argument in [
                *arguments.posonlyargs,
                *arguments.args,
                *arguments.kwonlyargs,
                *([arguments.vararg] if arguments.vararg else []),
                *([arguments.kwarg] if arguments.kwarg else []),
            ]:
                bound.add(argument.arg)
        pending = list(body)
        while pending:
            node = pending.pop()
            # 嵌套定义只在当前作用域绑定名字，不包含其函数/类体。
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(node.name)
                pending.extend(node.decorator_list)
                if isinstance(node, ast.ClassDef):
                    pending.extend(node.bases)
                    pending.extend(keyword.value for keyword in node.keywords)
                else:
                    pending.extend(node.args.defaults)
                    pending.extend(
                        value for value in node.args.kw_defaults if value is not None
                    )
                continue
            if isinstance(node, ast.Lambda):
                pending.extend(node.args.defaults)
                pending.extend(
                    value for value in node.args.kw_defaults if value is not None
                )
                continue
            # 推导迭代目标处于独立作用域；表达式中的海象绑定仍可向外。
            if isinstance(
                node,
                (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp),
            ):
                if isinstance(node, ast.DictComp):
                    pending.extend([node.key, node.value])
                else:
                    pending.append(node.elt)
                for generator in node.generators:
                    pending.append(generator.iter)
                    pending.extend(generator.ifs)
                continue
            if isinstance(node, ast.Name) and isinstance(
                node.ctx, (ast.Store, ast.Del)
            ):
                bound.add(node.id)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for alias in node.names:
                    if alias.name != "*":
                        bound.add(
                            alias.asname
                            or (
                                alias.name.split(".")[0]
                                if isinstance(node, ast.Import)
                                else alias.name
                            )
                        )
            elif isinstance(node, ast.ExceptHandler) and node.name:
                bound.add(node.name)
            elif isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
                bound.add(node.name)
            elif isinstance(node, ast.MatchMapping) and node.rest:
                bound.add(node.rest)
            pending.extend(ast.iter_child_nodes(node))
        self.scope_bindings[owner_id] = bound - declarations[0] - declarations[1]

    def _entity(
        self,
        kind: str,
        name: str,
        node: ast.AST,
        parent_id: str | None | bool = False,
    ) -> dict:
        """建立唯一位置对应的实体并关联其父作用域。

        Args:
            kind (str): 源码实体种类。
            name (str): 原始名称。
            node (ast.AST): 定义位置节点。
            parent_id (str | None | bool): 显式父实体，False 表示当前作用域。

        Returns:
            dict: 已加入项目容器的实体。
        """
        if parent_id is False:
            parent_id = self.scopes[-1] if self.scopes else None
        source_range = self.source.range_of(node)
        entity_id = make_id("entity", self.file["id"], kind, name, source_range["from"])
        parent = self.snapshot["entities"].get(parent_id)
        qualname = (
            f"{parent['qualname']}.{name}"
            if parent and parent["kind"] != "module"
            else name
        )
        entity = entity_record(
            entity_id,
            self.file["id"],
            kind,
            name,
            qualname,
            parent_id,
            source_range,
        )
        entity["name_range"] = self._name_range(node, name)
        self.snapshot["entities"][entity_id] = entity
        if parent:
            if entity_id not in parent["members"]:
                parent["members"].append(entity_id)
            if parent["kind"] == "module":
                self.file["members"].append(entity_id)
            elif kind in ("variable", "attribute"):
                parent["locals"].append(entity_id)
        return entity

    def _name_range(self, node: ast.AST, name: str) -> dict:
        """查找定义名或属性名的原始词元位置。

        Args:
            node (ast.AST): 名称所属语法节点。
            name (str): 需要定位的名称。

        Returns:
            dict: 精确的名称范围。
        """
        if isinstance(node, ast.Attribute):
            end_line = node.end_lineno or node.lineno
            end_column = self.source.character_column(
                end_line, node.end_col_offset or node.col_offset
            )
            return self.source.span(
                end_line,
                end_column - len(node.attr),
                end_line,
                end_column,
            )
        return self.source.find_name(node, name)

    def _comments(self, node: ast.AST) -> list[dict]:
        """保留定义附近和定义体内原始注释。

        Args:
            node (ast.AST): 函数或类定义节点。

        Returns:
            list[dict]: 注释原文、范围和关联种类。
        """
        start = min(
            [node.lineno]
            + [item.lineno for item in getattr(node, "decorator_list", [])]
        )
        preceding = start - 1
        while preceding > 0:
            line = self.source.lines[preceding - 1].strip()
            if not line.startswith("#"):
                break
            preceding -= 1
        end = node.end_lineno or start
        return [
            {
                "text": token.string,
                "range": self.source.span(*token.start, *token.end),
                "kind": "nearby" if token.start[0] < start else "body",
            }
            for token in self.source.comment_tokens
            if token.type == tokenize.COMMENT and preceding < token.start[0] <= end
        ]

    def _block(
        self,
        body: list[ast.AST],
        context: str | None = None,
        message_code: str = "",
        params: dict | None = None,
    ) -> None:
        """在可选逻辑上下文中遍历一个语句区块。

        Args:
            body (list[ast.AST]): 要读取的语句列表。
            context (str | None): 分支、循环或处理区块说明。
            message_code (str): 应用上下文的消息标识。
            params (dict | None): 保留原文的模板参数。

        Returns:
            None: 收集当前区块源码事实。
        """
        if context:
            self.contexts.append(context)
            self.context_messages.append(
                {
                    "message_code": message_code,
                    "params": params or {},
                }
            )
        for node in body:
            self._walk(node)
        if context:
            self.contexts.pop()
            self.context_messages.pop()

    def _walk(self, node: ast.AST | None) -> None:
        """维护当前语句位置后分派语法结构。

        Args:
            node (ast.AST | None): 待遍历的节点。

        Returns:
            None: 更新当前源码记录。
        """
        if node is None:
            return
        is_statement = isinstance(node, ast.stmt)
        if is_statement:
            self.statements.append(node)
        self._walk_node(node)
        if is_statement:
            self.statements.pop()

    def _walk_node(self, node: ast.AST) -> None:
        """按语法种类提取定义和引用，并处理作用域边界。

        Args:
            node (ast.AST): 当前语法节点。

        Returns:
            None: 将当前节点及必要子节点加入源码索引。
        """
        # 定义体必须切换作用域；默认值与装饰器属于外层定义过程。
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self._function(node)
            return
        if isinstance(node, ast.ClassDef):
            self._class(node)
            return
        if isinstance(node, ast.Lambda):
            self._lambda(node)
            return

        # 赋值只记录原文绑定，不求解容器拆包或对象运行值。
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            annotation = getattr(node, "annotation", None)
            for target in targets:
                self._binding(
                    target,
                    self.source.slice(getattr(node, "value", None)),
                    self.source.slice(annotation),
                    type(node).__name__,
                )
                self._walk(target)
            self._annotation(annotation)
            self._walk(getattr(node, "value", None))
            return
        if isinstance(node, ast.NamedExpr):
            self._binding(node.target, self.source.slice(node.value))
            self._walk(node.value)
            return
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            self._import(node)
            return

        # 条件与各子块保持独立的调用上下文。
        if isinstance(node, ast.If):
            self._expression(node.test, "条件判断", "context.condition")
            self._block(node.body, "if 条件成立", "context.if_true")
            self._block(node.orelse, "else 分支", "context.else")
            return
        if isinstance(node, (ast.For, ast.AsyncFor)):
            self._binding(node.target, self.source.slice(node.iter), "", "for")
            self._expression(node.iter, "循环迭代对象", "context.iterable")
            self._block(node.body, "循环体", "context.loop")
            self._block(node.orelse, "循环自然结束 else", "context.loop_else")
            return
        if isinstance(node, ast.While):
            self._expression(node.test, "循环条件", "context.loop_condition")
            self._block(node.body, "循环体", "context.loop")
            self._block(node.orelse, "循环自然结束 else", "context.loop_else")
            return
        if isinstance(node, (ast.With, ast.AsyncWith)):
            for item in node.items:
                self._expression(
                    item.context_expr, "上下文表达式", "context.with_expression"
                )
                if item.optional_vars is not None:
                    self._binding(
                        item.optional_vars,
                        self.source.slice(item.context_expr),
                        "",
                        "with",
                    )
            self._block(node.body, "上下文主体", "context.with_body")
            return
        if isinstance(node, (ast.Try, ast.TryStar)):
            self._block(node.body, "try 主体", "context.try")
            for handler in node.handlers:
                self._expression(
                    handler.type, "异常类型表达式", "context.exception_type"
                )
                if handler.name:
                    self._named_binding(handler.name, handler, "", "", "except")
                self._block(
                    handler.body,
                    "except " + self.source.slice(handler.type),
                    "context.except",
                    {"type": self.source.slice(handler.type)},
                )
            self._block(node.orelse, "try else（主体正常完成）", "context.try_else")
            self._block(node.finalbody, "finally", "context.finally")
            return
        if isinstance(node, ast.Match):
            self._expression(node.subject, "match 表达式", "context.match")
            for case in node.cases:
                self.contexts.append("case " + self.source.slice(case.pattern))
                self.context_messages.append(
                    {
                        "message_code": "context.case",
                        "params": {"pattern": self.source.slice(case.pattern)},
                    }
                )
                self._walk(case.pattern)
                self._expression(case.guard, "case 附加条件", "context.guard")
                self._block(case.body)
                self.contexts.pop()
                self.context_messages.pop()
            return

        # 表达式中的条件性保留为原文上下文，不能当作调用执行时序。
        if isinstance(node, ast.BoolOp):
            name = "and" if isinstance(node.op, ast.And) else "or"
            for value in node.values:
                self._expression(
                    value,
                    f"短路表达式 {name}（有条件求值）",
                    "context.short_circuit",
                    {"operator": name},
                )
            return
        if isinstance(node, ast.IfExp):
            self._expression(node.test, "条件表达式判断", "context.conditional_test")
            self._expression(
                node.body, "条件表达式成立分支", "context.conditional_true"
            )
            self._expression(
                node.orelse, "条件表达式否则分支", "context.conditional_false"
            )
            return
        if isinstance(
            node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
        ):
            context = (
                "生成器表达式（延迟求值）"
                if isinstance(node, ast.GeneratorExp)
                else "推导式（迭代与筛选条件约束）"
            )
            self.contexts.append(context)
            self.context_messages.append(
                {
                    "message_code": (
                        "context.generator"
                        if isinstance(node, ast.GeneratorExp)
                        else "context.comprehension"
                    ),
                    "params": {},
                }
            )
            for child in ast.iter_child_nodes(node):
                self._walk(child)
            self.contexts.pop()
            self.context_messages.pop()
            return

        if isinstance(node, ast.Call) and not self.annotation_depth:
            self._call(node)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            self._reference(node, node.id)
        elif isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load):
            self._reference(node, node.attr)
        elif isinstance(node, (ast.Return, ast.Yield, ast.YieldFrom)):
            owner = self.snapshot["entities"][self.scopes[-1]]
            if owner["kind"] in ("function", "method", "lambda"):
                owner["returns"].append(
                    {
                        "expression": self.source.slice(node.value),
                        "range": self.source.range_of(node),
                        "kind": (
                            "yield_from"
                            if isinstance(node, ast.YieldFrom)
                            else type(node).__name__.lower()
                        ),
                    }
                )
        elif isinstance(node, (ast.MatchAs, ast.MatchStar)):
            if node.name:
                self._named_binding(node.name, node, "", "", "match")
        elif isinstance(node, ast.MatchMapping) and node.rest:
            self._named_binding(node.rest, node, "", "", "match")
        for child in ast.iter_child_nodes(node):
            self._walk(child)

    def _expression(
        self,
        node: ast.AST | None,
        context: str,
        message_code: str,
        params: dict | None = None,
    ) -> None:
        """在明确表达式语义中收集引用和调用。

        Args:
            node (ast.AST | None): 可能为空的表达式。
            context (str): 调用所处的表达式上下文。
            message_code (str): 应用表达式上下文的消息标识。
            params (dict | None): 源码名称或表达式参数。

        Returns:
            None: 收集当前表达式事实。
        """
        self.contexts.append(context)
        self.context_messages.append(
            {
                "message_code": message_code,
                "params": params or {},
            }
        )
        self._walk(node)
        self.contexts.pop()
        self.context_messages.pop()

    def _annotation(self, node: ast.AST | None) -> None:
        """只记录类型注解引用，不把其中表达式混作函数体调用。

        Args:
            node (ast.AST | None): 类型注解表达式。

        Returns:
            None: 增加注解引用记录。
        """
        self.annotation_depth += 1
        self._expression(node, "类型注解", "context.annotation")
        self.annotation_depth -= 1

    def _function(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        """读取函数定义、参数和独立函数体。

        Args:
            node (ast.FunctionDef | ast.AsyncFunctionDef): 函数定义节点。

        Returns:
            None: 记录函数实体及属于它的源码事实。
        """
        parent = self.snapshot["entities"][self.scopes[-1]]
        kind = "method" if parent["kind"] == "class" else "function"
        entity = self._entity(kind, node.name, node)
        entity.update(
            {
                "docstring": ast.get_docstring(node, clean=False) or "",
                "comments": self._comments(node),
                "signature": self.source.signature(node),
                "return_annotation": self.source.slice(node.returns),
                "is_async": isinstance(node, ast.AsyncFunctionDef),
                "decorators": [self.source.slice(x) for x in node.decorator_list],
            }
        )
        for decorator in node.decorator_list:
            self._expression(decorator, "装饰器表达式（定义时）", "context.decorator")
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            self._expression(default, "默认参数表达式（定义时）", "context.default")
        for arg in [
            *node.args.posonlyargs,
            *node.args.args,
            *node.args.kwonlyargs,
            *([node.args.vararg] if node.args.vararg else []),
            *([node.args.kwarg] if node.args.kwarg else []),
        ]:
            self._annotation(arg.annotation)
        self._annotation(node.returns)
        for type_param in getattr(node, "type_params", []):
            self._annotation(type_param)

        self.scopes.append(entity["id"])
        self._prepare_scope(entity["id"], node.body, getattr(node, "args", None))
        self._parameters(node.args, entity)
        self.bodies[entity["id"]] = node.body
        previous_contexts = self.contexts
        previous_messages = self.context_messages
        self.contexts = ["函数体"]
        self.context_messages = [{"message_code": "context.function", "params": {}}]
        self._block(node.body)
        self.contexts = previous_contexts
        self.context_messages = previous_messages
        self.scopes.pop()

    def _parameters(self, args: ast.arguments, owner: dict) -> None:
        """保留全部参数种类、默认值和原始类型注解。

        Args:
            args (ast.arguments): 函数参数语法结构。
            owner (dict): 接收参数信息的函数实体。

        Returns:
            None: 更新函数参数列表及参数定义实体。
        """
        positional = [*args.posonlyargs, *args.args]
        defaults = [None] * (len(positional) - len(args.defaults))
        defaults += list(args.defaults)
        rows = []
        for index, (arg, default) in enumerate(zip(positional, defaults)):
            kind = (
                "positional_only"
                if index < len(args.posonlyargs)
                else "positional_or_keyword"
            )
            rows.append((arg, kind, default))
        if args.vararg:
            rows.append((args.vararg, "var_positional", None))
        rows.extend(
            (arg, "keyword_only", default)
            for arg, default in zip(args.kwonlyargs, args.kw_defaults)
        )
        if args.kwarg:
            rows.append((args.kwarg, "var_keyword", None))
        for arg, kind, default in rows:
            parameter = self._entity("parameter", arg.arg, arg)
            parameter["annotation"] = self.source.slice(arg.annotation)
            parameter["value"] = self.source.slice(default)
            owner["params"].append(
                {
                    "name": arg.arg,
                    "kind": kind,
                    "annotation": parameter["annotation"],
                    "default": parameter["value"] if default is not None else None,
                    "range": parameter["name_range"],
                    "entity_id": parameter["id"],
                }
            )

    def _class(self, node: ast.ClassDef) -> None:
        """读取类说明、基类和类体独立作用域。

        Args:
            node (ast.ClassDef): 类定义语法结构。

        Returns:
            None: 增加类及其属性、方法和类体调用。
        """
        entity = self._entity("class", node.name, node)
        entity.update(
            {
                "docstring": ast.get_docstring(node, clean=False) or "",
                "comments": self._comments(node),
                "signature": self.source.signature(node),
                "bases": [self.source.slice(x) for x in node.bases],
                "decorators": [self.source.slice(x) for x in node.decorator_list],
            }
        )
        for item in [*node.bases, *node.decorator_list]:
            self._expression(item, "类定义表达式", "context.class_definition")
        for item in node.keywords:
            self._expression(item.value, "类定义关键字表达式", "context.class_keyword")
        for type_param in getattr(node, "type_params", []):
            self._annotation(type_param)
        self.scopes.append(entity["id"])
        self._prepare_scope(entity["id"], node.body, getattr(node, "args", None))
        self.bodies[entity["id"]] = node.body
        previous_contexts = self.contexts
        previous_messages = self.context_messages
        self.contexts = ["类体初始化"]
        self.context_messages = [{"message_code": "context.class", "params": {}}]
        self._block(node.body)
        self.contexts = previous_contexts
        self.context_messages = previous_messages
        self.scopes.pop()

    def _lambda(self, node: ast.Lambda) -> None:
        """为匿名函数建立独立参数和表达式作用域。

        Args:
            node (ast.Lambda): 匿名函数表达式。

        Returns:
            None: 增加匿名函数实体，避免其内部调用误归属。
        """
        name = f"<lambda@{node.lineno}>"
        entity = self._entity("lambda", name, node)
        entity["signature"] = self.source.slice(node).split(":", 1)[0] + ":"
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            self._expression(
                default, "匿名函数默认参数（定义时）", "context.lambda_default"
            )
        self.scopes.append(entity["id"])
        self._prepare_scope(entity["id"], [node.body], node.args)
        self._parameters(node.args, entity)
        self.bodies[entity["id"]] = [node.body]
        self.statements.append(node.body)
        previous_contexts = self.contexts
        previous_messages = self.context_messages
        self.contexts = ["匿名函数体"]
        self.context_messages = [{"message_code": "context.lambda", "params": {}}]
        self._walk(node.body)
        entity["returns"].append(
            {
                "expression": self.source.slice(node.body),
                "range": self.source.range_of(node.body),
                "kind": "lambda",
            }
        )
        self.contexts = previous_contexts
        self.context_messages = previous_messages
        self.statements.pop()
        self.scopes.pop()

    def _binding(
        self,
        target: ast.AST,
        value: str,
        annotation: str = "",
        assignment_kind: str = "assignment",
    ) -> None:
        """记录赋值目标，不推测右侧实际运行值。

        Args:
            target (ast.AST): 名称、属性或拆包目标。
            value (str): 右侧原始表达式。
            annotation (str): 已有类型注解。
            assignment_kind (str): 赋值、循环或上下文绑定的种类。

        Returns:
            None: 记录每个可定位绑定。
        """
        if isinstance(target, ast.Name):
            self._named_binding(target.id, target, value, annotation, assignment_kind)
        elif isinstance(target, ast.Attribute):
            parent_id = self.scopes[-1]
            if isinstance(target.value, ast.Name) and target.value.id in (
                "self",
                "cls",
            ):
                for candidate_id in reversed(self.scopes):
                    if self.snapshot["entities"][candidate_id]["kind"] == "class":
                        parent_id = candidate_id
                        break
            entity = self._entity("attribute", target.attr, target, parent_id=parent_id)
            entity.update(
                {
                    "annotation": annotation,
                    "value": value,
                    "assignment_kind": assignment_kind,
                    "usage_owner_id": self.scopes[-1],
                }
            )
            owner = self.snapshot["entities"][self.scopes[-1]]
            if entity["id"] not in owner["locals"]:
                owner["locals"].append(entity["id"])
        elif isinstance(target, (ast.Tuple, ast.List)):
            for item in target.elts:
                self._binding(item, value, annotation, assignment_kind)
        elif isinstance(target, ast.Starred):
            self._binding(target.value, value, annotation, assignment_kind)

    def _named_binding(
        self,
        name: str,
        node: ast.AST,
        value: str,
        annotation: str,
        assignment_kind: str,
    ) -> None:
        """按 global/nonlocal 声明确定名称绑定的词法归属。

        Args:
            name (str): 被绑定的名称。
            node (ast.AST): 绑定位置。
            value (str): 右侧或来源原文。
            annotation (str): 已有注解。
            assignment_kind (str): 绑定种类。

        Returns:
            None: 增加可导航变量实体。
        """
        owner_id = self.scopes[-1]
        global_names, nonlocal_names = self.declarations.get(owner_id, (set(), set()))
        binding_scope = "local"
        if name in global_names:
            owner_id = self.scopes[0]
            binding_scope = "global"
        elif name in nonlocal_names:
            binding_scope = "nonlocal"
            candidates = [
                candidate_id
                for candidate_id in reversed(self.scopes[:-1])
                if self.snapshot["entities"][candidate_id]["kind"]
                in ("function", "method", "lambda")
                and name in self.scope_bindings.get(candidate_id, set())
            ]
            if candidates:
                owner_id = candidates[0]
            else:
                binding_scope = "unresolved_nonlocal"
                self.snapshot["diagnostics"].append(
                    {
                        "kind": "scope_error",
                        "severity": "warning",
                        "file_id": self.file["id"],
                        "line": getattr(node, "lineno", 1),
                        "message": f"nonlocal {name} 未找到外层词法绑定",
                        "message_code": "analysis.nonlocal_missing",
                        "params": {"name": name},
                    }
                )
        kind = (
            "attribute"
            if self.snapshot["entities"][owner_id]["kind"] == "class"
            else "variable"
        )
        entity = self._entity(kind, name, node, parent_id=owner_id)
        entity.update(
            {
                "annotation": annotation,
                "value": value,
                "assignment_kind": assignment_kind,
                "binding_scope": binding_scope,
                "usage_owner_id": self.scopes[-1],
            }
        )
        current_owner = self.snapshot["entities"][self.scopes[-1]]
        if (
            current_owner["kind"] != "module"
            and entity["id"] not in current_owner["locals"]
        ):
            current_owner["locals"].append(entity["id"])

    def _import(self, node: ast.Import | ast.ImportFrom) -> None:
        """保留导入原文、别名、相对层数和查询位置。

        Args:
            node (ast.Import | ast.ImportFrom): 导入语句。

        Returns:
            None: 增加文件导入记录，不执行导入。
        """
        groups = (
            [[alias] for alias in node.names]
            if isinstance(node, ast.Import)
            else [node.names]
        )
        for aliases in groups:
            first = aliases[0]
            module_name = (
                first.name if isinstance(node, ast.Import) else node.module or ""
            )
            token_name = first.asname or first.name.split(".")[-1]
            source_range = self.source.find_name(node, token_name)
            line, column = self.source.position(source_range["to"])
            record_id = make_id(
                "import", self.file["id"], source_range["from"], module_name
            )
            self.file["imports"].append(
                {
                    "id": record_id,
                    "expression": self.source.slice(node),
                    "module": module_name,
                    "names": [
                        {
                            "name": alias.name,
                            "asname": alias.asname,
                            "local_name": alias.asname
                            or (
                                alias.name.split(".")[0]
                                if isinstance(node, ast.Import)
                                else alias.name
                            ),
                        }
                        for alias in aliases
                    ],
                    "level": node.level if isinstance(node, ast.ImportFrom) else 0,
                    "range": self.source.range_of(node),
                    "line": line,
                    "column": column,
                    "owner_id": self.scopes[-1],
                    "status": "pending",
                    "targets": [],
                }
            )

    def _reference(self, node: ast.AST, name: str) -> None:
        """记录名称或属性的使用位置及其来源上下文。

        Args:
            node (ast.AST): 名称或属性读取节点。
            name (str): 查询词元名称。

        Returns:
            None: 增加按需定义查询的引用记录。
        """
        source_range = self._name_range(node, name)
        line, column = self.source.position(source_range["to"])
        reference_id = make_id("reference", self.file["id"], source_range["from"], name)
        self.snapshot["references"][reference_id] = {
            "id": reference_id,
            "file_id": self.file["id"],
            "owner_id": self.scopes[-1],
            "name": name,
            "expression": self.source.slice(node),
            "range": source_range,
            "line": line,
            "column": column,
            "kind": "annotation" if self.annotation_depth else "read",
            "context": " › ".join(self.contexts),
            "context_messages": list(self.context_messages),
            "status": "pending",
            "targets": [],
            "reason": "",
        }

    def _call(self, node: ast.Call) -> None:
        """记录一次显式调用及其原始实参和直接接收语句。

        Args:
            node (ast.Call): 调用表达式节点。

        Returns:
            None: 增加调用位置，暂不猜测目标。
        """
        source_range = self.source.range_of(node)
        call_id = make_id(
            "call", self.file["id"], source_range["from"], source_range["to"]
        )
        callee_range = self.source.range_of(node.func)
        query_range = callee_range
        if isinstance(node.func, ast.Name):
            query_range = self._name_range(node.func, node.func.id)
        elif isinstance(node.func, ast.Attribute):
            query_range = self._name_range(node.func, node.func.attr)
        line, column = self.source.position(query_range["to"])
        statement = self.statements[-1] if self.statements else node
        statement_range = self.source.range_of(statement)
        receiver = ""
        if (
            isinstance(statement, (ast.Assign, ast.AnnAssign, ast.NamedExpr))
            and statement.value is node
        ) or (isinstance(statement, ast.Return) and statement.value is node):
            receiver = self.source.slice(statement)
        arguments = []
        for arg in node.args:
            arguments.append(
                {
                    "name": None,
                    "kind": "star" if isinstance(arg, ast.Starred) else "positional",
                    "expression": self.source.slice(arg),
                    "range": self.source.range_of(arg),
                }
            )
        for keyword in node.keywords:
            arguments.append(
                {
                    "name": keyword.arg,
                    "kind": "keyword" if keyword.arg is not None else "double_star",
                    "expression": self.source.slice(keyword.value),
                    "range": self.source.range_of(keyword.value),
                }
            )
        self.snapshot["calls"][call_id] = {
            "id": call_id,
            "file_id": self.file["id"],
            "owner_id": self.scopes[-1],
            "range": source_range,
            "callee_range": callee_range,
            "line": line,
            "column": column,
            "expression": self.source.slice(node),
            "callee": self.source.slice(node.func),
            "args": arguments,
            "receiver": receiver,
            "logic_id": logic_id(
                self.file["id"], self.scopes[-1], statement_range["from"]
            ),
            "context": " › ".join(self.contexts),
            "context_messages": list(self.context_messages),
            "callee_kind": type(node.func).__name__.lower(),
            "status": "pending",
            "targets": [],
            "reason": "",
        }

    def _entrypoints(self, tree: ast.Module) -> None:
        """列出源码明确提供的模块入口候选。

        Args:
            tree (ast.Module): 已解析模块。

        Returns:
            None: 在项目入口列表中增加候选及依据。
        """
        if self.file["relative_path"].replace("\\", "/").endswith("__main__.py"):
            self.snapshot["entrypoints"].append(
                {
                    "file_id": self.file["id"],
                    "entity_id": self.file["module_id"],
                    "label": self.file["relative_path"],
                    "reason": "__main__.py 模块入口",
                    "message_code": "entry.module_main",
                    "params": {},
                }
            )
        for item in tree.body:
            if not isinstance(item, ast.If):
                continue
            test = item.test
            if not isinstance(test, ast.Compare):
                continue
            pieces = [test.left, *test.comparators]
            has_name = any(
                isinstance(piece, ast.Name) and piece.id == "__name__"
                for piece in pieces
            )
            has_main = any(
                isinstance(piece, ast.Constant) and piece.value == "__main__"
                for piece in pieces
            )
            if (
                has_name
                and has_main
                and any(isinstance(operator, ast.Eq) for operator in test.ops)
            ):
                self.snapshot["entrypoints"].append(
                    {
                        "file_id": self.file["id"],
                        "entity_id": self.file["module_id"],
                        "label": f"{self.file['relative_path']}:{item.lineno}",
                        "reason": "__name__ == '__main__' 入口守卫",
                        "message_code": "entry.main_guard",
                        "params": {},
                        "range": self.source.range_of(item),
                    }
                )


def extract_file(snapshot: dict, file_record: dict, tree: ast.Module) -> None:
    """将单文件源码结构添加到项目容器。

    Args:
        snapshot (dict): 当前分析结果容器。
        file_record (dict): 已成功解码的文件记录。
        tree (ast.Module): 解析成功的模块语法树。

    Returns:
        None: 增加文件中的定义、引用、调用和结构记录。
    """
    Extractor(snapshot, file_record).extract(tree)
