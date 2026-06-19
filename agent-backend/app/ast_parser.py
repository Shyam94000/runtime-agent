import re
from pathlib import Path

from app.config import settings
from app.models import SourceContext


DECLARATION_PATTERNS = [
    r"function\s+{name}\s*\(",
    r"const\s+{name}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>",
    r"let\s+{name}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>",
    r"var\s+{name}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>",
    r"const\s+{name}\s*=\s*function\s*\(",
    r"let\s+{name}\s*=\s*function\s*\(",
    r"var\s+{name}\s*=\s*function\s*\(",
    r"{name}\s*\([^)]*\)\s*\{",
]


def clean_function_name(frame: str) -> str | None:
    if not frame:
        return None
    match = re.search(r"([A-Za-z_$][A-Za-z0-9_$]*)\s*\(", frame)
    if match:
        name = match.group(1)
        if name not in {"if", "for", "while", "switch", "function"}:
            return name
    fallback = re.search(r"\b([A-Za-z_$][A-Za-z0-9_$]*)\b", frame)
    return fallback.group(1) if fallback else None


class JavaScriptSourceFinder:
    def __init__(self, source_dir: Path | None = None) -> None:
        self.source_dir = source_dir or settings.source_path
        try:
            from app.tree_sitter_parser import TreeSitterJSParser
            self.ts_parser = TreeSitterJSParser(self.source_dir)
        except ImportError:
            self.ts_parser = None

    def find_best_context(self, call_stack: list[str], anomaly_type: str) -> SourceContext | None:
        candidates = [clean_function_name(frame) for frame in call_stack]
        candidates = [name for name in candidates if name]
        preferred_by_type = {
            "cpu": ["fibonacci"],
            "memory": ["addToCache", "getCacheSize"],
            "event_loop": ["event-loop-block"],
            "error_rate": ["error-burst"],
            "db_latency": ["db-degradation"],
            "network_latency": ["network-delay"],
            "runtime_error": ["unhandled-rejection"],
        }
        preferred = preferred_by_type.get(anomaly_type, [])
        for name in preferred + candidates:
            found = self.find_function(name)
            if found:
                return found
        route_context = self.find_route_file(anomaly_type)
        if route_context:
            return route_context
        return self.first_js_context()

    def find_route_file(self, anomaly_type: str) -> SourceContext | None:
        route_by_type = {
            "event_loop": "event-loop-block.js",
            "error_rate": "error-burst.js",
            "db_latency": "db-degradation.js",
            "network_latency": "network-delay.js",
            "runtime_error": "unhandled-rejection.js",
        }
        route_name = route_by_type.get(anomaly_type)
        if not route_name or not self.source_dir.exists():
            return None
        for path in sorted(self.source_dir.rglob(route_name)):
            text = path.read_text(encoding="utf-8")
            lines = text.splitlines()
            return SourceContext(
                function_name=path.stem,
                file_path=str(path.resolve()),
                relative_file_path=str(path.relative_to(self.source_dir.parent)),
                start_line=1,
                end_line=len(lines),
                source_code="\n".join(lines),
            )
        return None

    def find_function(self, function_name: str) -> SourceContext | None:
        if getattr(self, 'ts_parser', None):
            result = self.ts_parser.find_function(function_name)
            if result:
                return result

        if not self.source_dir.exists():
            return None
        for path in sorted(self.source_dir.rglob("*.js")):
            text = path.read_text(encoding="utf-8")
            match = self._find_declaration(text, function_name)
            if not match:
                continue
            start_line, end_line, _ = self._extract_block(text, match.start())
            lines = text.splitlines()
            return SourceContext(
                function_name=function_name,
                file_path=str(path.resolve()),
                relative_file_path=str(path.relative_to(self.source_dir.parent)),
                start_line=start_line,
                end_line=end_line,
                source_code="\n".join(lines),
            )
        return None

    def first_js_context(self) -> SourceContext | None:
        if not self.source_dir.exists():
            return None
        for path in sorted(self.source_dir.rglob("*.js")):
            text = path.read_text(encoding="utf-8")
            lines = text.splitlines()
            return SourceContext(
                function_name="unknown",
                file_path=str(path.resolve()),
                relative_file_path=str(path.relative_to(self.source_dir.parent)),
                start_line=1,
                end_line=min(len(lines), 80),
                source_code="\n".join(lines[:80]),
            )
        return None

    def _find_declaration(self, text: str, function_name: str) -> re.Match[str] | None:
        escaped = re.escape(function_name)
        for pattern in DECLARATION_PATTERNS:
            match = re.search(pattern.replace("{name}", escaped), text)
            if match:
                return match
        return None

    def _extract_block(self, text: str, declaration_start: int) -> tuple[int, int, str]:
        brace_start = text.find("{", declaration_start)
        if brace_start == -1:
            lines = text.splitlines()
            start_line = text[:declaration_start].count("\n") + 1
            end_line = min(start_line + 20, len(lines))
            return start_line, end_line, "\n".join(lines[start_line - 1 : end_line])

        depth = 0
        end_index = len(text)
        in_string: str | None = None
        escape = False
        for index in range(brace_start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == in_string:
                    in_string = None
                continue
            if char in {"'", '"', "`"}:
                in_string = char
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end_index = index + 1
                    break

        start_line = text[:declaration_start].count("\n") + 1
        end_line = text[:end_index].count("\n") + 1
        lines = text.splitlines()
        return start_line, end_line, "\n".join(lines[start_line - 1 : end_line])
