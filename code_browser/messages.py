"""为应用异常携带确定性的界面消息标识，不包含任何语言字典。"""

from __future__ import annotations


def coded_error(
    error_type: type[Exception],
    message_code: str,
    message: str,
    **params: object,
) -> Exception:
    """在保留原异常类型和文字的同时附加可本地化消息参数。

    Args:
        error_type (type[Exception]): 现有异常类型，不改变捕获逻辑。
        message_code (str): 前端语言字典使用的语义消息标识。
        message (str): 保留的原中文说明或错误证据。
        **params (object): 前端模板所需的原始路径、名称或异常信息。

    Returns:
        Exception: 带 message_code 和 params 的原异常类型实例。
    """
    error = error_type(message)
    error.message_code = message_code
    error.params = params
    return error
