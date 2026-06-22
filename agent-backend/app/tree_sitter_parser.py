from pathlib import Path
from app.models import SourceContext

class TreeSitterJSParser:
    def __init__(self, source_dir: Path | str):
        import tree_sitter_javascript as tsjs
        from tree_sitter import Language, Parser
        JS_LANGUAGE = Language(tsjs.language())
        self.parser = Parser(JS_LANGUAGE)
        self.source_dir = Path(source_dir)

    def find_function(self, function_name: str) -> SourceContext | None:
        from tree_sitter import Query, QueryCursor
        for file_path in self.source_dir.rglob("*.js"):
            if "node_modules" in file_path.parts:
                continue

            try:
                source_code = file_path.read_text(encoding="utf-8")
                source_bytes = bytes(source_code, "utf8")
                tree = self.parser.parse(source_bytes)

                query = Query(self.parser.language, """
                    (function_declaration name: (identifier) @name) @func
                    (lexical_declaration 
                        (variable_declarator 
                            name: (identifier) @name 
                            value: [(arrow_function) (function_expression)]
                        )
                    ) @func
                    (method_definition name: (property_identifier) @name) @func
                """)
                cursor = QueryCursor(query)
                captures = cursor.captures(tree.root_node)
                
                if "name" in captures:
                    for node in captures["name"]:
                        found_name = source_bytes[node.start_byte:node.end_byte].decode("utf8")
                        if found_name == function_name:
                            func_node = node.parent
                            while func_node and func_node.type not in ('function_declaration', 'lexical_declaration', 'method_definition'):
                                func_node = func_node.parent
                            
                            if func_node:
                                return SourceContext(
                                    function_name=function_name,
                                    file_path=str(file_path),
                                    relative_file_path=str(file_path.relative_to(self.source_dir)),
                                    start_line=func_node.start_point.row + 1,
                                    end_line=func_node.end_point.row + 1,
                                    source_code=source_bytes[func_node.start_byte:func_node.end_byte].decode("utf8")
                                )
            except Exception as e:
                continue

        return None

    def find_all_functions(self, file_path: Path) -> list[dict]:
        from tree_sitter import Query, QueryCursor
        if not file_path.exists():
            return []
            
        source_code = file_path.read_text(encoding="utf-8")
        source_bytes = bytes(source_code, "utf8")
        tree = self.parser.parse(source_bytes)

        query = Query(self.parser.language, """
            (function_declaration name: (identifier) @name) @func
            (lexical_declaration 
                (variable_declarator 
                    name: (identifier) @name 
                    value: [(arrow_function) (function_expression)]
                )
            ) @func
            (method_definition name: (property_identifier) @name) @func
        """)
        cursor = QueryCursor(query)
        captures = cursor.captures(tree.root_node)
        
        results = []
        if "name" in captures:
            for node in captures["name"]:
                found_name = source_bytes[node.start_byte:node.end_byte].decode("utf8")
                func_node = node.parent
                while func_node and func_node.type not in ('function_declaration', 'lexical_declaration', 'method_definition'):
                    func_node = func_node.parent
                
                if func_node:
                    results.append({
                        "name": found_name,
                        "start_line": func_node.start_point.row + 1,
                        "end_line": func_node.end_point.row + 1,
                        "type": func_node.type
                    })
        return results

    def get_file_structure(self, file_path: Path) -> str:
        funcs = self.find_all_functions(file_path)
        if not funcs:
            return f"File: {file_path.name}\nNo explicit functions found."
        
        lines = [f"File: {file_path.name}"]
        for f in funcs:
            lines.append(f"  - {f['name']} (Lines {f['start_line']}-{f['end_line']})")
        return "\n".join(lines)
