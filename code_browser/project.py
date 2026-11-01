"""只读扫描本地源码目录，并汇总可序列化的项目结构。"""

from __future__ import annotations

import ast
import fnmatch
import os
import sys
import tomllib
from pathlib import Path
from typing import Callable

from .extract import extract_file
from .messages import coded_error
from .models import empty_snapshot, make_id
from .source import SourceMap, read_source

DEFAULT_EXCLUDES = (
    ".git",
    ".hg",
    ".svn",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    "node_modules",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".uv-cache",
    "build",
    "dist",
    "htmlcov",
)


def _is_link(path: Path) -> bool:
    """识别不应自动跟随的符号链接或目录联接。

    Args:
        path (Path): 待检查路径。

    Returns:
        bool: 是否为符号链接或 Windows 目录联接。
    """
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def _source_roots(root: Path, options: dict) -> tuple[list[Path], list[str]]:
    """确定显式搜索根以及可见的 src 布局建议。

    Args:
        root (Path): 项目根目录。
        options (dict): 用户提交的分析选项。

    Returns:
        tuple[list[Path], list[str]]: 实际源码根及自动识别建议。
    """
    suggestions = [str(root / "src")] if (root / "src").is_dir() else []
    requested = options.get("source_roots")
    if requested:
        roots = []
        for value in requested:
            path = Path(value).expanduser()
            roots.append(
                (root / path).resolve() if not path.is_absolute() else path.resolve()
            )
    else:
        roots = [Path(value) for value in suggestions] + [root]
    result = []
    for path in roots:
        if not path.is_dir():
            raise coded_error(
                ValueError,
                "analysis.invalid_source_root",
                f"源码根不是可读取目录：{path}",
                path=str(path),
            )
        if path not in result:
            result.append(path)
    return result, suggestions


def _scan_paths(
    root: Path,
    roots: list[Path],
    options: dict,
    snapshot: dict,
) -> list[Path]:
    """扫描用户范围内源码，记录排除项和目录访问错误。

    Args:
        root (Path): 项目根目录。
        roots (list[Path]): 可能包含额外显式目录的源码根。
        options (dict): 排除目录和存根选项。
        snapshot (dict): 接收诊断和排除范围的数据容器。

    Returns:
        list[Path]: 去重并排序的实际源码文件。
    """
    exclude = options.get("exclude_dirs")
    patterns = list(DEFAULT_EXCLUDES if exclude is None else exclude)
    snapshot["exclude_dirs"] = patterns
    suffixes = {".py", ".pyi"} if options.get("include_stubs", False) else {".py"}
    scan_roots = [root]
    for source_root in roots:
        if not source_root.is_relative_to(root):
            scan_roots.append(source_root)
    result: dict[str, Path] = {}

    def on_error(error: OSError) -> None:
        """记录目录读取失败而不放弃其余目录。

        Args:
            error (OSError): 操作系统给出的目录访问错误。

        Returns:
            None: 增加文件级诊断。
        """
        snapshot["diagnostics"].append(
            {
                "kind": "read_error",
                "severity": "warning",
                "path": str(error.filename),
                "message": str(error),
                "message_code": "analysis.directory_read_failed",
                "params": {"error": str(error)},
            }
        )

    for scan_root in scan_roots:
        for directory, names, files in os.walk(
            scan_root, topdown=True, onerror=on_error, followlinks=False
        ):
            current = Path(directory)
            allowed = []
            for name in sorted(names):
                path = current / name
                relative = (
                    str(path.relative_to(root))
                    if path.is_relative_to(root)
                    else str(path)
                ).replace("\\", "/")
                excluded = any(
                    fnmatch.fnmatch(name, pattern) or fnmatch.fnmatch(relative, pattern)
                    for pattern in patterns
                )
                linked = _is_link(path)
                if excluded or linked:
                    snapshot["excluded"].append(
                        {
                            "path": str(path),
                            "reason": "链接目录未跟随" if linked else "排除目录",
                            "message_code": (
                                "analysis.skipped_directory_link"
                                if linked
                                else "analysis.excluded_directory"
                            ),
                            "params": {},
                        }
                    )
                else:
                    allowed.append(name)
            names[:] = allowed
            for name in sorted(files):
                path = current / name
                if path.suffix not in suffixes:
                    continue
                if _is_link(path):
                    snapshot["excluded"].append(
                        {
                            "path": str(path),
                            "reason": "链接文件未跟随",
                            "message_code": "analysis.skipped_file_link",
                            "params": {},
                        }
                    )
                    continue
                result[os.path.normcase(str(path.resolve()))] = path.resolve()
    return sorted(result.values(), key=lambda path: str(path).casefold())


def _import_roots(roots: list[Path]) -> dict[Path, Path]:
    """从常规包链推导导入根，保留各源根的独立命名归属。

    Args:
        roots (list[Path]): 按用户优先顺序排列的源码扫描根。

    Returns:
        dict[Path, Path]: 源码根到导入根的映射，不改变扫描范围。
    """
    result = {}
    for source_root in roots:
        import_root = source_root
        # 连续 __init__.py 是常规包前缀的依据；非包目录保持原根。
        while (
            import_root.parent != import_root
            and (import_root / "__init__.py").is_file()
        ):
            import_root = import_root.parent
        result[source_root] = import_root
    return result


def _module_name(path: Path, roots: dict[Path, Path]) -> str:
    """按文件所属源根及其导入根推导完整模块名称。

    Args:
        path (Path): 源码文件绝对路径。
        roots (dict[Path, Path]): 按优先顺序排列的源根及导入根。

    Returns:
        str: 与实际导入路径一致、保留常规包前缀的模块名称。
    """
    relative = next(
        path.relative_to(import_root)
        for source_root, import_root in roots.items()
        if path.is_relative_to(source_root)
    )
    parts = list(relative.with_suffix("").parts)
    if parts and parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts) or "__init__"


def _file_record(path: Path, root: Path, roots: dict[Path, Path]) -> dict:
    """创建始终能够返回解析状态的文件记录。

    Args:
        path (Path): 文件绝对路径。
        root (Path): 项目根目录。
        roots (dict[Path, Path]): 源码根到实际导入根的映射。

    Returns:
        dict: 初始文件元信息。
    """
    relative = (
        str(path.relative_to(root))
        if path.is_relative_to(root)
        else "@source/" + str(path).replace(":", "")
    ).replace("\\", "/")
    file_id = make_id("file", os.path.normcase(str(path)))
    return {
        "id": file_id,
        "path": str(path),
        "relative_path": relative,
        "module": _module_name(path, roots),
        "source": "",
        "hash": "",
        "encoding": "",
        "docstring": "",
        "comments": [],
        "range": {
            "from": 0,
            "to": 0,
            "line": 1,
            "end_line": 1,
        },
        "parse_status": "pending",
        "members": [],
        "imports": [],
        "module_id": None,
        "is_stub": path.suffix == ".pyi",
    }


def _configured_entries(root: Path, snapshot: dict) -> None:
    """只读提取 pyproject 中明示的脚本入口。

    Args:
        root (Path): 项目根目录。
        snapshot (dict): 实体和入口记录容器。

    Returns:
        None: 增加有配置依据的入口候选。
    """
    config = root / "pyproject.toml"
    if not config.is_file():
        return
    try:
        with config.open("rb") as handle:
            project = tomllib.load(handle).get("project", {})
    except (OSError, tomllib.TOMLDecodeError) as error:
        snapshot["diagnostics"].append(
            {
                "kind": "config_error",
                "severity": "warning",
                "path": str(config),
                "message": f"无法读取静态入口配置：{error}",
                "message_code": "analysis.config_read_failed",
                "params": {"error": str(error)},
            }
        )
        return
    for section in ("scripts", "gui-scripts"):
        for label, expression in project.get(section, {}).items():
            if not isinstance(expression, str):
                continue
            module, _, qualname = expression.partition(":")
            qualname = qualname.split("[", 1)[0].strip()
            candidates = [
                entity
                for entity in snapshot["entities"].values()
                if snapshot["files"][entity["file_id"]]["module"] == module
                and entity["qualname"] == qualname
            ]
            snapshot["entrypoints"].append(
                {
                    "file_id": candidates[0]["file_id"]
                    if len(candidates) == 1
                    else None,
                    "entity_id": candidates[0]["id"] if len(candidates) == 1 else None,
                    "label": label,
                    "expression": expression,
                    "reason": f"pyproject.toml 的 project.{section} 静态入口",
                    "message_code": "entry.script",
                    "params": {"section": section},
                    "status": "resolved" if len(candidates) == 1 else "unresolved",
                }
            )


def build_project(
    root: str,
    options: dict | None = None,
    progress: Callable[[dict], None] | None = None,
) -> dict:
    """只读建立项目的文件、实体、引用、调用和内部结构。

    Args:
        root (str): 用户选择的项目根目录。
        options (dict | None): 源码根、排除目录及存根等选项。
        progress (Callable[[dict], None] | None): 接收阶段进度的回调。

    Returns:
        dict: 不含运行时语法树的可序列化源码事实容器。
    """
    options = options or {}
    project_root = Path(root).expanduser().resolve()
    if not project_root.is_dir():
        raise coded_error(
            ValueError,
            "analysis.invalid_root",
            f"项目根目录不存在或不是目录：{project_root}",
            path=str(project_root),
        )
    roots, suggestions = _source_roots(project_root, options)
    snapshot = empty_snapshot(str(project_root), [str(path) for path in roots])
    # 项目根始终是扫描范围；显式源码根只影响其优先级，不移除它。
    naming_roots = roots if project_root in roots else [*roots, project_root]
    import_roots = _import_roots(naming_roots)
    snapshot["import_roots"] = list(
        dict.fromkeys(str(path) for path in import_roots.values())
    )
    snapshot["suggested_source_roots"] = suggestions
    snapshot["python_version"] = sys.version.split()[0]
    snapshot["include_stubs"] = bool(options.get("include_stubs", False))
    paths = _scan_paths(project_root, roots, options, snapshot)
    total = len(paths)
    if progress:
        progress(
            {
                "stage": "extracting",
                "files_processed": 0,
                "files_total": total,
            }
        )
    # 每个文件独立处理读取和语法错误，内部实现错误应交给工作进程报告。
    module_files: dict[str, list[str]] = {}
    for index, path in enumerate(paths):
        file_record = _file_record(path, project_root, import_roots)
        snapshot["files"][file_record["id"]] = file_record
        try:
            text, encoding, digest = read_source(path)
            file_record.update(
                {
                    "source": text,
                    "encoding": encoding,
                    "hash": digest,
                    "range": SourceMap(text).range_of(
                        ast.Module(body=[], type_ignores=[])
                    ),
                }
            )
        except (OSError, UnicodeError, SyntaxError, LookupError) as error:
            file_record["parse_status"] = "unreadable"
            snapshot["diagnostics"].append(
                {
                    "file_id": file_record["id"],
                    "path": str(path),
                    "kind": "read_error",
                    "severity": "warning",
                    "message": f"源码读取或解码失败：{error}",
                    "message_code": "analysis.source_read_failed",
                    "params": {"error": str(error)},
                }
            )
        else:
            try:
                tree = ast.parse(text, filename=str(path), type_comments=True)
            except (SyntaxError, ValueError, RecursionError) as error:
                file_record["parse_status"] = "syntax_error"
                snapshot["diagnostics"].append(
                    {
                        "file_id": file_record["id"],
                        "path": str(path),
                        "kind": "syntax_error",
                        "severity": "warning",
                        "line": getattr(error, "lineno", 1),
                        "column": getattr(error, "offset", 1),
                        "message": f"无法按当前 Python 语法解析：{error}",
                        "message_code": "analysis.syntax_error",
                        "params": {"error": str(error)},
                    }
                )
            else:
                file_record["parse_status"] = "ok"
                extract_file(snapshot, file_record, tree)
                module_files.setdefault(file_record["module"], []).append(
                    file_record["id"]
                )
        if progress:
            progress(
                {
                    "stage": "extracting",
                    "files_processed": index + 1,
                    "files_total": total,
                    "path": str(path),
                }
            )
    for module, files in module_files.items():
        if len(files) > 1:
            snapshot["diagnostics"].append(
                {
                    "kind": "module_ambiguity",
                    "severity": "warning",
                    "message": f"模块名 {module} 对应多个文件，请核对源码根",
                    "message_code": "analysis.module_ambiguity",
                    "params": {"module": module},
                    "file_ids": files,
                }
            )
    _configured_entries(project_root, snapshot)
    return snapshot
