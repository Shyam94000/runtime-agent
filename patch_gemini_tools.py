import re

with open("agent-backend/app/agent_tools.py", "r") as f:
    content = f.read()

rag_tool = """
def semantic_search_codebase(query: str, n_results: int = 5) -> str:
    \"\"\"Search the entire codebase semantically using vector search for a specific concept or functionality.
    
    Args:
        query: A natural language description of what code you are looking for (e.g. 'database connection setup' or 'authentication middleware').
        n_results: Maximum number of relevant functions to return.
    \"\"\"
    return memory.search_code(query, n_results)

# Available tools
AGENT_TOOLS = [
    read_file,
    list_directory,
    search_files,
    get_file_exports,
    semantic_search_codebase,
]"""

content = content.replace(
    '# Available tools\nAGENT_TOOLS = [\n    read_file,\n    list_directory,\n    search_files,\n    get_file_exports,\n]',
    rag_tool
)

with open("agent-backend/app/agent_tools.py", "w") as f:
    f.write(content)
