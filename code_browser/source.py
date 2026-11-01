"""保留源码原文，并集中转换字节、字符和网页 UTF-16 位置。"""

from __future__ import annotations

import ast
import bisect
import hashlib
import io
import re
import tokenize
from pathlib import Path


def read_source(path: str | Path) -> tuple[str, str, str]:
    """只读加载源码，识别编码并计算原始文件摘要。

    Args:
        path (str | Path): 待读取的 Python 源码路径。

    Returns:
        tuple[str, str, str]: 原文、编码名称及原始字节 SHA-256 摘要。
    """
    raw = Path(path).read_bytes()
    encoding, _ = tokenize.detect_encoding(io.BytesIO(raw).readline)
    return raw.decode(encoding), encoding, hashlib.sha256(raw).hexdigest()


class SourceMap:
    """表示原始源码以及不同位置计量方式间的映射对象。

    属性:
        text: 未重新生成的源码原文。
        lines: 保留物理换行的原文行。
        char_starts: 各行在 Unicode 字符文本中的起点。
        utf16_starts: 各行在网页 UTF-16 文本中的起点。
        length: 全文的 UTF-16 长度。
        tokens: 用于名称定位的原始词法记录。
        token_offsets: 词法记录的 UTF-16 起点。
        name_tokens: 按名称归类的词法记录。
        name_offsets: 每个名称各次出现的起点。
        comment_tokens: 原始注释词元。
        _column_cache: 已计算的各行 UTF-16 字符边界。
    """

    def __init__(self, text: str) -> None:
        """保存原文并建立行起点索引。

        Args:
            text (str): 已解码、保留原换行的源码原文。

        Returns:
            None: 初始化对象，不产生外部文件。
        """
        # text 是原始显示文本；行索引用于 AST、Jedi 与网页位置互转。
        self.text = text
        # 仅物理换行分行，字符串中的 U+2028 等字符不改变 AST 行号。
        self.lines = re.split(r"(?<=\n)|(?<=\r)(?!\n)", text)
        self.char_starts: list[int] = []
        self.utf16_starts: list[int] = []
        self._column_cache: dict[int, list[int]] = {}
        char_offset = 0
        utf16_offset = 0
        for line in self.lines:
            self.char_starts.append(char_offset)
            self.utf16_starts.append(utf16_offset)
            char_offset += len(line)
            utf16_offset += len(line.encode("utf-16-le")) // 2
        self.length = utf16_offset
        # tokens 是原始词法记录；语法错误时保留已经扫描到的部分。
        self.tokens: list[tokenize.TokenInfo] = []
        scanner = tokenize.generate_tokens(io.StringIO(text, newline=None).readline)
        try:
            self.tokens.extend(scanner)
        except (tokenize.TokenError, IndentationError, SyntaxError):
            pass
        # 名称和注释索引避免每次定位都从文件首词元重新遍历。
        self.token_offsets = [self.point(*token.start) for token in self.tokens]
        self.name_tokens: dict[str, list] = {}
        self.name_offsets: dict[str, list[int]] = {}
        self.comment_tokens: list[tokenize.TokenInfo] = []
        for token in self.tokens:
            if token.type == tokenize.NAME:
                self.name_tokens.setdefault(token.string, []).append(token)
                self.name_offsets.setdefault(token.string, []).append(
                    self.point(*token.start)
                )
            elif token.type == tokenize.COMMENT:
                self.comment_tokens.append(token)

    def _columns(self, row: int) -> list[int]:
        """获得指定行每个字符边界的 UTF-16 列位置。

        Args:
            row (int): 从零开始的有效行索引。

        Returns:
            list[int]: 每个 Unicode 字符边界对应的 UTF-16 列。
        """
        if row not in self._column_cache:
            columns = [0]
            for char in self.lines[row]:
                columns.append(columns[-1] + (2 if ord(char) > 0xFFFF else 1))
            self._column_cache[row] = columns
        return self._column_cache[row]

    def point(self, line: int, char_column: int) -> int:
        """把行号与字符列转换为网页 UTF-16 绝对偏移。

        Args:
            line (int): 从一开始的行号。
            char_column (int): 从零开始的 Unicode 字符列。

        Returns:
            int: 从零开始的 UTF-16 文本偏移。
        """
        row = max(0, min(line - 1, len(self.lines) - 1))
        column = max(0, min(char_column, len(self.lines[row])))
        return self.utf16_starts[row] + self._columns(row)[column]

    def position(self, utf16_offset: int) -> tuple[int, int]:
        """把网页偏移转换为 Jedi 使用的行号和字符列。

        Args:
            utf16_offset (int): 从零开始的 UTF-16 文本偏移。

        Returns:
            tuple[int, int]: 从一开始的行号和从零开始的字符列。
        """
        offset = max(0, min(utf16_offset, self.length))
        row = max(0, bisect.bisect_right(self.utf16_starts, offset) - 1)
        column = (
            bisect.bisect_right(self._columns(row), offset - self.utf16_starts[row]) - 1
        )
        return row + 1, max(0, column)

    def character_column(self, line: int, byte_column: int) -> int:
        """把 AST 的 UTF-8 字节列转换为字符列。

        Args:
            line (int): 从一开始的行号。
            byte_column (int): AST 提供的 UTF-8 字节列。

        Returns:
            int: 对应的 Unicode 字符列。
        """
        row = max(0, min(line - 1, len(self.lines) - 1))
        raw_prefix = self.lines[row].encode("utf-8")[:byte_column]
        return len(raw_prefix.decode("utf-8", errors="ignore"))

    def span(
        self,
        start_line: int,
        start_column: int,
        end_line: int,
        end_column: int,
    ) -> dict:
        """根据字符坐标构造统一网页范围。

        Args:
            start_line (int): 起始行号。
            start_column (int): 起始字符列。
            end_line (int): 结束行号。
            end_column (int): 结束字符列，右边界不包含在范围内。

        Returns:
            dict: 含 from、to、line、end_line 的范围记录。
        """
        return {
            "from": self.point(start_line, start_column),
            "to": self.point(end_line, end_column),
            "line": start_line,
            "end_line": end_line,
        }

    def range_of(self, node: ast.AST) -> dict:
        """将语法节点范围转换为统一网页坐标。

        Args:
            node (ast.AST): 具有源码位置信息的语法节点。

        Returns:
            dict: 节点对应的 UTF-16 范围；模块范围为整份原文。
        """
        if not hasattr(node, "lineno"):
            return {
                "from": 0,
                "to": self.length,
                "line": 1,
                "end_line": len(self.lines),
            }
        start_line = node.lineno
        end_line = getattr(node, "end_lineno", None) or start_line
        start_column = self.character_column(start_line, node.col_offset)
        end_column = self.character_column(
            end_line, getattr(node, "end_col_offset", None) or node.col_offset
        )
        return self.span(start_line, start_column, end_line, end_column)

    def text_of(self, source_range: dict) -> str:
        """从网页范围取回完全对应的原始文本。

        Args:
            source_range (dict): UTF-16 左闭右开源码范围。

        Returns:
            str: 对应的原始文本。
        """
        start_line, start_column = self.position(source_range["from"])
        end_line, end_column = self.position(source_range["to"])
        start = self.char_starts[start_line - 1] + start_column
        end = self.char_starts[end_line - 1] + end_column
        return self.text[start:end]

    def slice(self, node: ast.AST | None) -> str:
        """读取语法节点的源码原文。

        Args:
            node (ast.AST | None): 语法节点，None 表示没有表达式。

        Returns:
            str: 原始表达式或空字符串。
        """
        return "" if node is None else self.text_of(self.range_of(node))

    def find_name(self, node: ast.AST, name: str) -> dict:
        """在节点范围内定位准确的名称词元。

        Args:
            node (ast.AST): 名称所属语法节点。
            name (str): 要定位的原始名称。

        Returns:
            dict: 名称范围；找不到时返回节点范围。
        """
        bounds = self.range_of(node)
        tokens = self.name_tokens.get(name, [])
        offsets = self.name_offsets.get(name, [])
        index = bisect.bisect_left(offsets, bounds["from"])
        if index < len(tokens) and offsets[index] < bounds["to"]:
            token = tokens[index]
            return self.span(*token.start, *token.end)
        return bounds

    def signature(self, node: ast.AST) -> str:
        """读取函数或类定义头部的原始文本。

        Args:
            node (ast.AST): 函数、异步函数或类定义节点。

        Returns:
            str: 截止最外层冒号的完整定义头部。
        """
        bounds = self.range_of(node)
        depth = 0
        start_at = bisect.bisect_left(self.token_offsets, bounds["from"])
        for token in self.tokens[start_at:]:
            offset = self.point(*token.start)
            if offset < bounds["from"]:
                continue
            if offset >= bounds["to"]:
                break
            if token.string in ("(", "[", "{"):
                depth += 1
            elif token.string in (")", "]", "}"):
                depth -= 1
            elif token.string == ":" and depth == 0:
                header_range = {
                    **bounds,
                    "to": self.point(*token.end),
                }
                return self.text_of(header_range).strip()
        return self.slice(node).splitlines()[0] if self.slice(node) else ""
