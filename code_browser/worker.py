"""隔离分析工作进程，提供进度、串行查询和只读结果。"""

from __future__ import annotations

import copy
import multiprocessing as mp
import os
import queue
import threading
import uuid
from pathlib import Path
from typing import Any

from .messages import coded_error


def _analysis_process(root, options, commands, events, runtime_dir):
    """在独立进程中提取结构并串行处理语义查询。

    Args:
        root (str): 被分析的本地目录。
        options (dict): 源码范围与查询配置。
        commands (Queue): 主服务发送的查询命令。
        events (Queue): 返回结果和进度的通道。
        runtime_dir (str): 工具自身缓存目录。

    Returns:
        None: 结果通过事件通道返回。
    """
    # 工具运行目录和解释器始终独立于被分析项目。
    os.environ.pop("PYTHONPATH", None)
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    from code_browser.project import build_project
    from code_browser.resolve import Resolver, SnapshotChanged

    def progress(data):
        """转发结构提取进度。

        Args:
            data (dict): 当前处理阶段与计数。

        Returns:
            None: 发送进度事件。
        """
        events.put({"type": "progress", "data": data})

    def handle(command):
        """执行一次串行定义或引用查询。

        Args:
            command (dict): 查询标识、动作和参数。

        Returns:
            None: 发送结果及必要的引用索引更新。
        """
        request_id = command["request_id"]
        try:
            if command["action"] == "definition":
                result = resolver.definition(
                    command["file_id"], command["offset"], command["mode"]
                )
            elif command["action"] == "references":

                def reference_progress(data):
                    """转发符号引用索引进度。

                    Args:
                        data (dict): 已完成位置与总数。

                    Returns:
                        None: 发送状态事件。
                    """
                    events.put({"type": "reference_progress", "data": data})

                result = resolver.index_references(
                    command.get("file_id"), reference_progress
                )
                events.put(
                    {
                        "type": "references",
                        "references": copy.deepcopy(snapshot["references"]),
                        "reference_index": copy.deepcopy(
                            snapshot.get("reference_index", {})
                        ),
                        "result": result,
                    }
                )
            else:
                raise coded_error(
                    ValueError,
                    "analysis.unsupported_command",
                    "不支持的分析命令",
                )
            events.put({"type": "result", "request_id": request_id, "data": result})
        except Exception as exc:
            events.put(
                {
                    "type": "result",
                    "request_id": request_id,
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                    "message_code": getattr(exc, "message_code", "analysis.failed"),
                    "params": getattr(exc, "params", {"error": str(exc)}),
                }
            )

    try:
        snapshot = build_project(root, options, progress)
        events.put({"type": "structure", "snapshot": copy.deepcopy(snapshot)})
        resolver = Resolver(snapshot, options, Path(runtime_dir) / "jedi")
        resolver.resolve_imports()
        events.put({"type": "imports", "files": copy.deepcopy(snapshot["files"])})
        calls = list(snapshot["calls"].values())
        for number, call in enumerate(calls, 1):
            # 每次调用位置都保存原始表达式，即使查询没有返回目标。
            call.update(resolver.resolve_call(call))
            events.put(
                {
                    "type": "call",
                    "call": copy.deepcopy(call),
                    "processed": number,
                    "total": len(calls),
                }
            )
            while True:
                try:
                    command = commands.get_nowait()
                except queue.Empty:
                    break
                handle(command)
        resolver.assert_current()
        events.put({"type": "ready", "snapshot": copy.deepcopy(snapshot)})
        while True:
            handle(commands.get())
    except BaseException as exc:
        events.put(
            {
                "type": "failed",
                "error": f"{type(exc).__name__}: {exc}",
                "stale": isinstance(exc, SnapshotChanged),
                "message_code": getattr(exc, "message_code", "analysis.failed"),
                "params": getattr(exc, "params", {"error": str(exc)}),
            }
        )


class AnalysisManager:
    """管理一个活动项目与其只读分析进程。"""

    def __init__(self, runtime_dir: Path):
        """准备工作进程管理状态。

        Args:
            runtime_dir (Path): 工具自己的缓存与运行目录。

        Returns:
            None: 初始化空项目状态。
        """
        self.runtime_dir = runtime_dir  # 缓存目录，不位于被分析项目中。
        self.context = mp.get_context("spawn")  # 跨平台独立解释器进程。
        self.lock = threading.RLock()  # 保护事件更新与页面查询的共享状态。
        self.process = None  # 当前工具分析进程。
        self.commands = None  # 串行工作命令通道。
        self.events = None  # 结果和进度通道。
        self.snapshot = None  # 最近已发布的结构与调用索引。
        self.pending = {}  # 等待特定查询结果的本地同步对象。
        self.options = {}  # 当前项目分析配置。
        self.state = {"id": None, "stage": "idle", "ready": False}

    def start(self, root: str, options: dict) -> dict:
        """启动一个项目，替换工具自身的旧分析。

        Args:
            root (str): 已选项目的绝对目录。
            options (dict): 源码范围与超时选项。

        Returns:
            dict: 新的分析标识和初始进度。
        """
        project_root = Path(root).expanduser().resolve()
        if not project_root.is_dir():
            raise coded_error(
                ValueError,
                "analysis.invalid_root",
                "项目目录不存在或不是文件夹",
                path=str(project_root),
            )
        self.stop()
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        with self.lock:
            analysis_id = uuid.uuid4().hex
            self.options = options
            self.snapshot = None
            self.state = {
                "id": analysis_id,
                "root": str(project_root),
                "stage": "scanning",
                "ready": False,
                "structure_ready": False,
                "stale": False,
                "files_processed": 0,
                "files_total": 0,
                "calls_processed": 0,
                "calls_total": 0,
                "diagnostics": [],
                "reference_status": {"stage": "idle"},
            }
            self.commands = self.context.Queue()
            self.events = self.context.Queue()
            self.process = self.context.Process(
                target=_analysis_process,
                args=(
                    str(project_root),
                    options,
                    self.commands,
                    self.events,
                    str(self.runtime_dir),
                ),
                daemon=True,
            )
            self.process.start()
            process, events = self.process, self.events
        threading.Thread(
            target=self._collect,
            args=(analysis_id, process, events),
            daemon=True,
        ).start()
        return self.status(analysis_id)

    def _collect(self, analysis_id, process, events):
        """接收工作进程事件并保存可读结果。

        Args:
            analysis_id (str): 本轮结果标识。
            process (Process): 所属工具进程。
            events (Queue): 所属事件通道。

        Returns:
            None: 进度与数据保存在管理对象中。
        """
        while True:
            try:
                event = events.get(timeout=0.5)
            except queue.Empty:
                with self.lock:
                    if self.state.get("id") != analysis_id:
                        return
                    if not process.is_alive():
                        if self.state["stage"] not in {"cancelled", "failed"}:
                            self.state.update(
                                stage="failed",
                                ready=False,
                                error="分析进程已退出，请重新分析",
                                message_code="analysis.process_exited",
                                params={},
                            )
                            self._release_pending(
                                "分析进程已退出", "analysis.process_exited"
                            )
                        return
                continue
            except (EOFError, OSError):
                return
            with self.lock:
                if self.state.get("id") != analysis_id or self.state.get("stage") in {
                    "cancelled",
                    "failed",
                }:
                    return
                kind = event["type"]
                if kind == "progress":
                    self.state.update(event["data"])
                elif kind == "structure":
                    self.snapshot = event["snapshot"]
                    self.state.update(
                        stage="indexing",
                        structure_ready=True,
                        files_total=len(self.snapshot["files"]),
                        files_processed=len(self.snapshot["files"]),
                        calls_total=len(self.snapshot["calls"]),
                        diagnostics=self.snapshot["diagnostics"],
                    )
                elif kind == "imports":
                    self.snapshot["files"] = event["files"]
                elif kind == "call":
                    self.snapshot["calls"][event["call"]["id"]] = event["call"]
                    self.state.update(
                        stage="indexing",
                        calls_processed=event["processed"],
                        calls_total=event["total"],
                    )
                elif kind == "ready":
                    self.snapshot = event["snapshot"]
                    self.state.update(
                        stage="ready",
                        ready=True,
                        structure_ready=True,
                        calls_processed=len(self.snapshot["calls"]),
                        diagnostics=self.snapshot["diagnostics"],
                    )
                elif kind == "reference_progress":
                    self.state["reference_status"] = {
                        **event["data"],
                        "stage": "indexing",
                    }
                elif kind == "references":
                    self.snapshot["references"] = event["references"]
                    self.snapshot["reference_index"] = event["reference_index"]
                    self.state["reference_status"] = {
                        "stage": "ready",
                        **event["result"],
                    }
                elif kind == "result":
                    waiter = self.pending.pop(event["request_id"], None)
                    if waiter is not None:
                        waiter["result"] = event
                        waiter["event"].set()
                    if event.get("error_type") == "SnapshotChanged":
                        self.state["stale"] = True
                elif kind == "failed":
                    self.state.update(
                        stage="failed",
                        ready=False,
                        error=event["error"],
                        stale=event.get("stale", False),
                        message_code=event["message_code"],
                        params=event["params"],
                    )
                    self._release_pending(
                        event["error"], event["message_code"], event["params"]
                    )
                    return

    def _release_pending(self, message, message_code, params=None):
        """结束当前未完成的查询等待。

        Args:
            message (str): 中断原因。
            message_code (str): 原因对应的界面消息标识。
            params (dict | None): 模板中的原始错误证据。

        Returns:
            None: 等待者收到明确错误。
        """
        for waiter in self.pending.values():
            waiter["result"] = {
                "error": message,
                "message_code": message_code,
                "params": params or {},
            }
            waiter["event"].set()
        self.pending.clear()

    def status(self, analysis_id: str) -> dict:
        """返回一次分析的状态副本。

        Args:
            analysis_id (str): 页面持有的分析标识。

        Returns:
            dict: 进度、诊断与索引完成状态。
        """
        with self.lock:
            if analysis_id != self.state.get("id"):
                raise coded_error(
                    KeyError,
                    "analysis.expired",
                    "分析结果已过期，请重新选择当前项目",
                )
            return copy.deepcopy(self.state)

    def data(self, analysis_id: str) -> dict:
        """取得已发布的只读项目索引。

        Args:
            analysis_id (str): 页面持有的分析标识。

        Returns:
            dict: 当前分析的项目数据。
        """
        with self.lock:
            self.status(analysis_id)
            if self.snapshot is None:
                raise coded_error(
                    RuntimeError, "analysis.reading", "正在读取项目，请稍后"
                )
            return self.snapshot

    def query(self, analysis_id: str, action: str, **arguments) -> Any:
        """将定义或引用查询交给串行工作进程。

        Args:
            analysis_id (str): 当前分析标识。
            action (str): 查询动作。
            **arguments (dict): 动作所需的文件、位置等参数。

        Returns:
            Any: 工作进程的查询结果。
        """
        with self.lock:
            self.data(analysis_id)
            if not self.process or not self.process.is_alive():
                raise coded_error(
                    RuntimeError,
                    "analysis.process_unavailable",
                    "分析进程不可用，请重新分析",
                )
            request_id = uuid.uuid4().hex
            waiter = {"event": threading.Event(), "result": None}
            self.pending[request_id] = waiter
            self.commands.put({"request_id": request_id, "action": action, **arguments})
        timeout = float(self.options.get("query_timeout", 30))
        if not waiter["event"].wait(timeout):
            self.stop()
            with self.lock:
                self.state.update(
                    stage="failed",
                    ready=False,
                    error="定义查询超时，分析进程已停止；原文仍可查看，请重新分析",
                    message_code="analysis.query_timeout_stopped",
                    params={},
                )
            raise coded_error(
                TimeoutError,
                "analysis.query_timeout",
                "查询超时，请缩小范围或提高查询超时设置",
            )
        result = waiter["result"]
        if "error" in result:
            raise coded_error(
                RuntimeError,
                result["message_code"],
                result["error"],
                **result["params"],
            )
        return result["data"]

    def references(self, analysis_id: str, file_id=None) -> dict:
        """后台建立符号引用索引。

        Args:
            analysis_id (str): 当前分析标识。
            file_id (str | None): 单文件标识，空表示整个项目。

        Returns:
            dict: 已开始或正在处理的引用状态。
        """
        with self.lock:
            self.data(analysis_id)
            if self.state["reference_status"].get("stage") == "indexing":
                return copy.deepcopy(self.state["reference_status"])
            self.state["reference_status"] = {"stage": "indexing", "processed": 0}

        def perform():
            """等待引用索引并报告失败。

            Args:
                无。

            Returns:
                None: 更新引用阶段。
            """
            try:
                self.query(analysis_id, "references", file_id=file_id)
            except (RuntimeError, TimeoutError, KeyError) as exc:
                with self.lock:
                    if self.state.get("id") == analysis_id:
                        self.state["reference_status"] = {
                            "stage": "failed",
                            "error": str(exc),
                            "message_code": getattr(
                                exc, "message_code", "analysis.failed"
                            ),
                            "params": getattr(exc, "params", {"error": str(exc)}),
                        }

        threading.Thread(target=perform, daemon=True).start()
        return {"stage": "indexing"}

    def stop(self):
        """终止工具自身的分析进程，保留已发布原文。

        Args:
            无。

        Returns:
            None: 结束工作进程并释放查询等待。
        """
        with self.lock:
            process = self.process
            if process is not None and process.is_alive():
                process.terminate()
                process.join(timeout=3)
            self.process = None
            if self.state.get("id"):
                self.state.update(
                    stage="cancelled",
                    ready=False,
                    message_code="analysis.cancelled",
                    params={},
                )
            self._release_pending(
                "工具分析已取消；未执行或终止任何目标项目进程",
                "analysis.cancelled",
            )
