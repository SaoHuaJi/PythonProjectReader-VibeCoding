"""启动、识别和关闭当前工作区的本机项目阅读服务。"""

from __future__ import annotations

import argparse
import errno
import json
import os
import socket
import threading
import time
import uuid
import webbrowser
from pathlib import Path
from urllib.error import URLError
from urllib.request import ProxyHandler, build_opener


def _runtime_path(runtime_dir: Path | None) -> Path:
    """取得当前工作区的服务运行目录。

    Args:
        runtime_dir (Path | None): 显式运行目录；为空时采用工具目录。

    Returns:
        Path: 服务状态和停止请求所在的绝对目录。
    """
    if runtime_dir is not None:
        return Path(runtime_dir).expanduser().resolve()
    return Path(__file__).resolve().parent.parent / "work" / "runtime"


def _read_record(runtime_dir: Path) -> dict | None:
    """读取可识别的服务记录，允许处理异常退出留下的损坏记录。

    Args:
        runtime_dir (Path): 当前工具的运行目录。

    Returns:
        dict | None: 进程号、端口、地址和实例标识，或没有有效记录。
    """
    try:
        record = json.loads((runtime_dir / "service.json").read_text(encoding="utf-8"))
        return {
            "pid": int(record["pid"]),
            "port": int(record["port"]),
            "url": str(record["url"]),
            "instance_id": uuid.UUID(str(record["instance_id"])).hex,
        }
    except (
        FileNotFoundError,
        UnicodeError,
        json.JSONDecodeError,
        KeyError,
        TypeError,
        ValueError,
    ):
        return None


def _is_running(record: dict) -> bool:
    """通过现有配置接口确认记录对应的服务实例仍在运行。

    Args:
        record (dict): 当前工作区保存的服务信息。

    Returns:
        bool: 配置接口返回的实例标识是否与记录一致。
    """
    try:
        # 本机请求不经过用户环境中的外部代理。
        opener = build_opener(ProxyHandler({}))
        with opener.open(record["url"] + "/api/config", timeout=1) as response:
            config = json.loads(response.read().decode("utf-8"))
        return config.get("instance_id") == record["instance_id"]
    except (OSError, URLError, UnicodeError, ValueError, AttributeError):
        return False


def _stop_path(runtime_dir: Path, instance_id: str) -> Path:
    """取得一个服务实例自己的停止请求路径。

    Args:
        runtime_dir (Path): 当前工作区运行目录。
        instance_id (str): 已识别的实例标识。

    Returns:
        Path: 只供该实例监视的停止请求文件。
    """
    return runtime_dir / f"stop-{instance_id}.request"


def _clear_instance(runtime_dir: Path, instance_id: str) -> None:
    """清理指定实例的记录和停止文件，不扫描或删除其他实例文件。

    Args:
        runtime_dir (Path): 当前工作区运行目录。
        instance_id (str): 当前需要清理的实例标识。

    Returns:
        None: 清理本实例的工具运行文件。
    """
    _stop_path(runtime_dir, instance_id).unlink(missing_ok=True)
    current = _read_record(runtime_dir)
    if current and current["instance_id"] == instance_id:
        (runtime_dir / "service.json").unlink(missing_ok=True)


def stop_service(runtime_dir: Path | None = None, timeout: float = 10.0) -> int:
    """请求关闭当前工作区登记的服务，不按端口或进程名杀进程。

    Args:
        runtime_dir (Path | None): 服务运行目录；为空时使用工具默认目录。
        timeout (float): 等待正常关闭的最长秒数。

    Returns:
        int: 已关闭或没有服务返回零，未能确认关闭返回一。
    """
    runtime = _runtime_path(runtime_dir)
    record = _read_record(runtime)
    if record is None:
        state_file = runtime / "service.json"
        if state_file.exists():
            state_file.unlink()
            print("已清理无效服务记录；当前没有可识别的运行实例。", flush=True)
        else:
            print("当前工作区没有已登记的运行服务。", flush=True)
        return 0
    if not _is_running(record):
        _clear_instance(runtime, record["instance_id"])
        print("已清理失效服务记录；当前没有可识别的运行实例。", flush=True)
        return 0

    # 请求由实际服务进程处理，停止端不接触 Windows 启动器或其他进程。
    marker = _stop_path(runtime, record["instance_id"])
    marker.write_text("stop\n", encoding="utf-8")
    print(f"正在关闭 PythonProjectReader：{record['url']}", flush=True)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = _read_record(runtime)
        if current is None or current["instance_id"] != record["instance_id"]:
            marker.unlink(missing_ok=True)
            print("PythonProjectReader 已关闭。", flush=True)
            return 0
        time.sleep(0.1)
    if not _is_running(record):
        _clear_instance(runtime, record["instance_id"])
        print("服务已停止响应，已清理其失效记录。", flush=True)
        return 0
    print("未能在等待时间内确认关闭；保留服务记录，请查看启动终端。", flush=True)
    return 1


def run_service(
    project: str = "",
    port: int | None = None,
    no_browser: bool = False,
    runtime_dir: Path | None = None,
) -> int:
    """运行本机服务，优先使用默认端口并登记真正的服务进程。

    Args:
        project (str): 页面预填的待分析项目目录。
        port (int | None): 为空时优先使用8778，占用则自动分配；零直接自动分配。
        no_browser (bool): 是否只打印地址而不自动打开浏览器。
        runtime_dir (Path | None): 工具服务状态及缓存目录。

    Returns:
        int: 正常退出或实例已在运行返回零，启动失败返回一。
    """
    os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
    runtime = _runtime_path(runtime_dir)
    previous = _read_record(runtime)
    if previous is not None and _is_running(previous):
        print(
            f"PythonProjectReader 已在运行，访问地址：{previous['url']}",
            flush=True,
        )
        return 0

    # 失效记录不代表仍占用端口；只清理本工作区登记的信息。
    runtime.mkdir(parents=True, exist_ok=True)
    if previous is not None:
        _clear_instance(runtime, previous["instance_id"])
        print("已清理失效服务记录，准备启动新实例。", flush=True)
    elif (runtime / "service.json").exists():
        (runtime / "service.json").unlink()
        print("已清理无效服务记录，准备启动新实例。", flush=True)
    try:
        import uvicorn

        from code_browser.api import create_app
    except ImportError as exc:
        print(
            f"运行依赖或应用文件不完整：{exc.name}。"
            "请按 README 安装 requirements.txt 中的依赖。",
            flush=True,
        )
        return 1

    application = create_app(project, runtime)
    instance_id = uuid.uuid4().hex
    application.state.service_instance = instance_id
    # 直接持有已绑定并监听的套接字，只有默认端口被占用时才自动分配。
    requested_port = 8778 if port is None else port
    try:
        try:
            listener = socket.create_server(("127.0.0.1", requested_port))
        except OSError as exc:
            if port is not None or exc.errno != errno.EADDRINUSE:
                raise
            listener = socket.create_server(("127.0.0.1", 0))
    except (OSError, OverflowError) as exc:
        print(f"无法绑定本机服务端口：{exc}", flush=True)
        return 1
    actual_port = listener.getsockname()[1]
    # 框架接收同一监听套接字；实际就绪后再由监视器发布地址。
    config = uvicorn.Config(
        application, host="127.0.0.1", port=actual_port, log_level="warning"
    )
    server = uvicorn.Server(config)
    record = {
        "pid": os.getpid(),
        "port": actual_port,
        "url": f"http://127.0.0.1:{actual_port}",
        "instance_id": instance_id,
    }
    finished = threading.Event()
    monitor_errors: list[str] = []

    def monitor() -> None:
        """在真正就绪后发布地址，并监视本实例的关闭请求。

        Args:
            无；读取当前服务、运行目录和停止标记。

        Returns:
            None: 收到停止请求后结束监视，或随主服务退出。
        """
        published = False
        try:
            while not finished.wait(0.05):
                if not server.started:
                    continue
                if not published:
                    (runtime / "service.json").write_text(
                        json.dumps(record, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    print(
                        f"PythonProjectReader 已启动，访问地址：{record['url']}",
                        flush=True,
                    )
                    published = True
                    if not no_browser:
                        threading.Thread(
                            target=webbrowser.open,
                            args=(record["url"],),
                            daemon=True,
                        ).start()
                if _stop_path(runtime, instance_id).exists():
                    application.state.manager.stop()
                    server.should_exit = True
                    return
        except (OSError, RuntimeError) as exc:
            monitor_errors.append(str(exc))
            server.should_exit = True

    watcher = threading.Thread(target=monitor, daemon=True)
    watcher.start()
    try:
        server.run(sockets=[listener])
    except KeyboardInterrupt:
        pass
    finally:
        finished.set()
        watcher.join(timeout=5)
        listener.close()
        _clear_instance(runtime, instance_id)
    if monitor_errors:
        print(f"服务状态管理失败：{monitor_errors[0]}", flush=True)
        return 1
    if not server.started:
        print("服务未能完成启动，请查看上方错误。", flush=True)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    """读取启动或停止参数，并保持跨平台共同入口。

    Args:
        argv (list[str] | None): 可选命令参数；为空时读取真实命令行。

    Returns:
        int: 正常结束返回零，启动或停止操作失败返回一。
    """
    parser = argparse.ArgumentParser(description="离线 Python 项目源码阅读器")
    parser.add_argument("--project", default="", help="页面预填的目标项目目录")
    parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="本机端口，默认优先8778，占用时自动分配；0表示直接自动分配",
    )
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器")
    parser.add_argument("--stop", action="store_true", help="关闭当前工作区的服务")
    arguments = parser.parse_args(argv)
    try:
        if arguments.stop:
            return stop_service()
        return run_service(arguments.project, arguments.port, arguments.no_browser)
    except (OSError, ValueError, OverflowError) as exc:
        print(f"服务操作失败：{exc}", flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
