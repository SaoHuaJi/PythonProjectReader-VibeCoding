"""提供本机网页、项目查询与只读源码接口。"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import platform
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from code_browser.index import call_detail, entity_detail, file_detail, graph, search
from code_browser.worker import AnalysisManager

TOOL_ROOT = Path(__file__).resolve().parent.parent


class AnalysisRequest(BaseModel):
    """表示用户选择的本地项目及只读分析范围。"""

    root: str = Field(min_length=1)  # 被分析项目的本地路径。
    source_roots: list[str] = Field(default_factory=list)  # 导入搜索根。
    dependency_paths: list[str] = Field(default_factory=list)  # 只读依赖源码目录。
    exclude_dirs: list[str] = Field(default_factory=list)  # 用户额外排除的目录。
    include_stubs: bool = False  # 是否把类型存根纳入文件列表。
    query_timeout: float = Field(default=30, ge=1, le=600)  # 单次查询等待秒数。


class DefinitionRequest(BaseModel):
    """表示源码中一个名称的绑定或类型查询。"""

    analysis_id: str  # 页面持有的分析结果标识。
    file_id: str  # 已登记的源文件标识。
    offset: int = Field(ge=0)  # UTF-16 文本偏移。
    mode: Literal["binding", "type"] = "binding"  # 定义查询类别。


class ReferenceRequest(BaseModel):
    """表示用户请求建立符号引用索引的范围。"""

    analysis_id: str  # 当前分析标识。
    file_id: str | None = None  # 为空表示当前整个项目。


def create_app(default_root=None, runtime_dir=None) -> FastAPI:
    """创建单项目本地网页应用。

    Args:
        default_root (str | None): 页面预填的项目路径。
        runtime_dir (Path | None): 工具运行数据目录。

    Returns:
        FastAPI: 可由本机服务启动的应用。
    """
    manager = AnalysisManager(Path(runtime_dir or TOOL_ROOT / "work" / "runtime"))

    @asynccontextmanager
    async def lifespan(application):
        """管理工具工作进程的生命周期。

        Args:
            application (FastAPI): 当前网页应用。

        Yields:
            None: 应用正常提供服务的阶段。
        """
        yield
        manager.stop()

    app = FastAPI(
        title="PythonProjectReader",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.state.manager = manager

    def api_failure(status_code, detail, message_code, params=None):
        """创建带明确界面语义的接口异常，不翻译原始证据。

        Args:
            status_code (int): HTTP 状态码。
            detail (str): 保留给中文界面与日志的原始说明。
            message_code (str): 前端双语字典使用的应用消息标识。
            params (dict | None): 路径或底层错误等原文参数。

        Returns:
            HTTPException: 可由统一处理器序列化的异常。
        """
        return HTTPException(
            status_code,
            {
                "text": detail,
                "message_code": message_code,
                "params": params or {},
            },
        )

    @app.exception_handler(HTTPException)
    async def application_error(request, exc):
        """将应用错误的语义与原文同时交给界面。

        Args:
            request (Request): 原始本地请求。
            exc (HTTPException): 路由抛出的应用异常。

        Returns:
            JSONResponse: 原状态码、消息标识、参数及原始说明。
        """
        if isinstance(exc.detail, dict) and "message_code" in exc.detail:
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "detail": exc.detail["text"],
                    "message_code": exc.detail["message_code"],
                    "params": exc.detail["params"],
                },
            )
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    def data(analysis_id):
        """验证分析标识并取得已发布索引。

        Args:
            analysis_id (str): 请求中的分析标识。

        Returns:
            dict: 当前只读分析数据。
        """
        try:
            return manager.data(analysis_id)
        except KeyError as exc:
            raise api_failure(
                410,
                str(exc),
                getattr(exc, "message_code", "api.analysis_expired"),
                getattr(exc, "params", {}),
            ) from exc
        except RuntimeError as exc:
            raise api_failure(
                409,
                str(exc),
                getattr(exc, "message_code", "api.analysis_not_ready"),
                getattr(exc, "params", {"error": str(exc)}),
            ) from exc

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        """以中文报告接口参数问题。

        Args:
            request (Request): 原始请求。
            exc (RequestValidationError): 参数验证错误。

        Returns:
            JSONResponse: 中文错误和对应字段。
        """
        return JSONResponse(
            status_code=422,
            content={
                "detail": "请求参数不合法，请检查项目路径、范围或查询设置",
                "message_code": "api.invalid_request",
                "params": {},
                "fields": [".".join(map(str, e["loc"])) for e in exc.errors()],
            },
        )

    @app.get("/api/config")
    def config():
        """提供工具解释器及页面默认配置。

        Args:
            无。

        Returns:
            dict: 本机工具信息和源码范围建议。
        """
        return {
            "default_root": default_root or "",
            "instance_id": getattr(app.state, "service_instance", None),
            "message_code": "api.syntax_support",
            "params": {},
            "python_version": platform.python_version(),
            "analyzer": "Python ast / tokenize + Jedi",
            "supported": "支持当前解释器语法；动态关系可能无法静态定位",
            "exclude_dirs": [
                ".git",
                ".venv",
                "venv",
                "__pycache__",
                "node_modules",
                "build",
                "dist",
                ".pytest_cache",
            ],
        }

    @app.post("/api/analyses")
    def begin(body: AnalysisRequest):
        """开始分析用户选定的本地项目。

        Args:
            body (AnalysisRequest): 项目路径及范围。

        Returns:
            dict: 分析标识与初始状态。
        """
        try:
            options = body.model_dump(exclude={"root"}, exclude_unset=True)
            return manager.start(body.root, options)
        except (ValueError, OSError) as exc:
            raise api_failure(
                400,
                str(exc),
                getattr(exc, "message_code", "api.invalid_project"),
                getattr(exc, "params", {"error": str(exc)}),
            ) from exc

    @app.get("/api/analyses/{analysis_id}")
    def status(analysis_id: str):
        """返回当前分析的进度与诊断。

        Args:
            analysis_id (str): 分析结果标识。

        Returns:
            dict: 阶段、计数、诊断和过期信息。
        """
        try:
            return manager.status(analysis_id)
        except KeyError as exc:
            raise api_failure(
                410,
                str(exc),
                getattr(exc, "message_code", "api.analysis_expired"),
                getattr(exc, "params", {}),
            ) from exc

    @app.delete("/api/analyses/{analysis_id}")
    def cancel(analysis_id: str):
        """取消工具的分析任务。

        Args:
            analysis_id (str): 要取消的当前任务。

        Returns:
            dict: 已取消状态。
        """
        status(analysis_id)
        manager.stop()
        return manager.status(analysis_id)

    @app.get("/api/files")
    def files(analysis_id: str = Query(...)):
        """返回当前项目文件清单和入口候选。

        Args:
            analysis_id (str): 当前分析标识。

        Returns:
            dict: 文件概要、源码根和入口。
        """
        snapshot = data(analysis_id)
        fields = (
            "id",
            "path",
            "relative_path",
            "module",
            "parse_status",
            "module_id",
            "docstring",
        )
        return {
            "files": [
                {key: item.get(key) for key in fields}
                for item in snapshot["files"].values()
            ],
            "entrypoints": snapshot.get("entrypoints", []),
            "root": snapshot["root"],
            "source_roots": snapshot.get("source_roots", []),
        }

    @app.get("/api/files/{file_id}")
    def file_info(file_id: str, analysis_id: str = Query(...)):
        """返回文件原说明、成员和模块引用。

        Args:
            file_id (str): 已分析的文件。
            analysis_id (str): 当前分析标识。

        Returns:
            dict: 文件详情。
        """
        snapshot = data(analysis_id)
        if file_id not in snapshot["files"]:
            raise api_failure(404, "没有找到该文件", "api.file_missing")
        result = copy.deepcopy(file_detail(snapshot, file_id))
        result.pop("source", None)
        return result

    @app.get("/api/files/{file_id}/source")
    def source(file_id: str, analysis_id: str = Query(...)):
        """读取本次分析所用原文，并核对当前磁盘摘要。

        Args:
            file_id (str): 已分析文件。
            analysis_id (str): 当前分析标识。

        Returns:
            dict: 原文、摘要和是否过期。
        """
        snapshot = data(analysis_id)
        item = snapshot["files"].get(file_id)
        if item is None:
            raise api_failure(404, "没有找到该文件", "api.file_missing")
        # 原本无法解码的文件没有文本摘要，不把原有诊断误报为后续变化。
        stale = False
        if item.get("parse_status") != "unreadable":
            try:
                current_hash = hashlib.sha256(
                    Path(item["path"]).read_bytes()
                ).hexdigest()
                stale = current_hash != item["hash"]
            except OSError:
                stale = True
        if stale:
            with manager.lock:
                manager.state["stale"] = True
        return {
            "id": file_id,
            "path": item["path"],
            "source": item["source"],
            "hash": item["hash"],
            "stale": stale,
        }

    @app.get("/api/entities/{entity_id}")
    def entity(entity_id: str, analysis_id: str = Query(...)):
        """返回函数、类、变量等定义及其关系。

        Args:
            entity_id (str): 源码实体标识。
            analysis_id (str): 当前分析标识。

        Returns:
            dict: 原说明、输入输出、成员和调用位置。
        """
        snapshot = data(analysis_id)
        if entity_id not in snapshot["entities"]:
            raise api_failure(404, "没有找到该定义", "api.entity_missing")
        return copy.deepcopy(entity_detail(snapshot, entity_id))

    @app.get("/api/entities/{entity_id}/logic")
    def logic(entity_id: str, analysis_id: str = Query(...)):
        """返回一个函数的原始语句结构。

        Args:
            entity_id (str): 函数或模块实体标识。
            analysis_id (str): 当前分析标识。

        Returns:
            dict: 可展开的内部结构节点。
        """
        snapshot = data(analysis_id)
        item = snapshot["entities"].get(entity_id)
        if item is None:
            raise api_failure(404, "没有找到该定义", "api.entity_missing")
        return {"entity_id": entity_id, "nodes": item.get("logic", [])}

    @app.get("/api/calls/{call_id}")
    def call(call_id: str, analysis_id: str = Query(...)):
        """返回图上一次具体调用的原文和参数。

        Args:
            call_id (str): 调用位置标识。
            analysis_id (str): 当前分析标识。

        Returns:
            dict: 调用位置及候选目标。
        """
        item = data(analysis_id)["calls"].get(call_id)
        if item is None:
            raise api_failure(404, "没有找到该调用位置", "api.call_missing")
        return copy.deepcopy(call_detail(data(analysis_id), item))

    @app.get("/api/graph")
    def relations(
        analysis_id: str = Query(...),
        kind: Literal["module", "call", "reference"] = "module",
        focus: str | None = None,
        direction: Literal["both", "incoming", "outgoing"] = "both",
        depth: int = Query(1, ge=0, le=20),
        limit: int = Query(150, ge=1, le=2000),
        offset: int = Query(0, ge=0),
        internal_only: bool = False,
    ):
        """返回可按需展开的关系图。

        Args:
            analysis_id (str): 当前分析标识。
            kind (str): 文件、调用或符号引用关系。
            focus (str | None): 当前关注的实体或文件。
            direction (str): 入边、出边或双向。
            depth (int): 从焦点扩展的层数。
            limit (int): 本次显示数量。
            offset (int): 继续加载的位置。
            internal_only (bool): 是否仅显示项目内目标。

        Returns:
            dict: 节点、连线及未显示数量。
        """
        return graph(
            data(analysis_id),
            kind,
            focus,
            direction,
            depth,
            limit,
            offset,
            internal_only,
        )

    @app.get("/api/search")
    def find(
        analysis_id: str = Query(...),
        q: str = "",
        limit: int = Query(100, ge=1, le=500),
    ):
        """按名称或文件检索已有定义。

        Args:
            analysis_id (str): 当前分析标识。
            q (str): 查询文字。
            limit (int): 本次结果数。

        Returns:
            dict: 检索结果与剩余数量。
        """
        result = search(data(analysis_id), q, limit)
        result["results"] = result.get("items", result.get("results", []))
        return result

    @app.post("/api/definitions")
    async def definition(body: DefinitionRequest):
        """查询源码名称的绑定或可能类型。

        Args:
            body (DefinitionRequest): 名称位置与查询方式。

        Returns:
            dict: 定义候选及未解析原因。
        """
        data(body.analysis_id)
        try:
            return await asyncio.to_thread(
                manager.query,
                body.analysis_id,
                "definition",
                file_id=body.file_id,
                offset=body.offset,
                mode=body.mode,
            )
        except (RuntimeError, TimeoutError, KeyError) as exc:
            raise api_failure(
                409,
                str(exc),
                getattr(exc, "message_code", "api.definition_failed"),
                getattr(exc, "params", {"error": str(exc)}),
            ) from exc

    @app.post("/api/references/index")
    def references(body: ReferenceRequest):
        """启动指定范围的符号引用索引。

        Args:
            body (ReferenceRequest): 当前项目及文件范围。

        Returns:
            dict: 已开始的后台处理状态。
        """
        snapshot = data(body.analysis_id)
        if body.file_id and body.file_id not in snapshot["files"]:
            raise api_failure(404, "没有找到该文件", "api.file_missing")
        return manager.references(body.analysis_id, body.file_id)

    static_dir = TOOL_ROOT / "code_browser" / "static"
    if static_dir.is_dir():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="web")
    else:

        @app.get("/")
        def not_built():
            """说明本地网页尚未构建。

            Args:
                无。

            Returns:
                HTMLResponse: 中文构建提示。
            """
            return HTMLResponse(
                "<html lang='zh-CN'><meta charset='utf-8'>"
                "<h1>PythonProjectReader</h1><p>请先在 web 目录执行 npm run build，"
                "再启动本地服务。</p></html>",
                status_code=503,
            )

    return app
