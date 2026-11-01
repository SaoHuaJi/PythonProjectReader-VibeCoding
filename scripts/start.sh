#!/bin/sh
# 启动本地服务；参数直接传给 Python，例如 --project 路径或 --no-browser。
# 输出：实际访问地址及服务日志；exec 保留 Python 的退出码。
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd) || exit 1
PYTHON="$ROOT/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
    printf '%s\n' "未找到项目虚拟环境，请先按 README 创建 .venv 并安装依赖。" >&2
    exit 1
fi
cd "$ROOT" || exit 1
exec "$PYTHON" -B -m code_browser "$@"
