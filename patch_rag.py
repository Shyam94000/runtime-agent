import re

with open("agent-backend/app/agent_memory.py", "r") as f:
    content = f.read()

rag_import = """import os
import chromadb
from chromadb.config import Settings
"""
content = content.replace("from typing import Any", rag_import + "from typing import Any")

init_rag = """    def __init__(self, target_path: str):
        self.target_path = target_path
        self.parsed_files: dict[str, dict[str, Any]] = {}
        
        # Initialize ChromaDB for RAG
        db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "chromadb")
        os.makedirs(db_path, exist_ok=True)
        self.chroma_client = chromadb.PersistentClient(path=db_path, settings=Settings(anonymized_telemetry=False))
        self.collection = self.chroma_client.get_or_create_collection(name="codebase_functions")"""
        
content = content.replace(
    '    def __init__(self, target_path: str):\n        self.target_path = target_path\n        self.parsed_files: dict[str, dict[str, Any]] = {}',
    init_rag
)

index_rag = """        # After parsing all files, index them in ChromaDB
        self._index_codebase_for_rag()
        
    def _index_codebase_for_rag(self):
        \"\"\"Index all functions in the codebase into ChromaDB for vector search.\"\"\"
        docs = []
        metadatas = []
        ids = []
        
        for file_path, data in self.parsed_files.items():
            for func in data.get("functions", []):
                func_id = f"{file_path}::{func['name']}"
                code = func["code"]
                # Create a search document combining name, params, and code
                doc = f"Function: {func['name']}\\nFile: {file_path}\\nCode:\\n{code}"
                
                docs.append(doc)
                metadatas.append({
                    "file_path": file_path,
                    "function_name": func["name"],
                    "start_line": func["start_line"],
                    "end_line": func["end_line"]
                })
                ids.append(func_id)
                
        if docs:
            # Upsert into Chroma (Chroma handles embedding automatically using all-MiniLM-L6-v2 by default)
            self.collection.upsert(
                documents=docs,
                metadatas=metadatas,
                ids=ids
            )
            print(f"[AgentMemory] Indexed {len(docs)} functions into RAG collection.")"""
            
content = content.replace(
    '                        "imports": result.get("imports", [])\n                    }',
    '                        "imports": result.get("imports", [])\n                    }\n' + index_rag
)

search_rag = """    def search_code(self, query: str, n_results: int = 5) -> str:
        \"\"\"Semantic search across the codebase using ChromaDB RAG.\"\"\"
        if not self.collection.count():
            return "No code indexed for search."
            
        results = self.collection.query(
            query_texts=[query],
            n_results=min(n_results, self.collection.count())
        )
        
        if not results["documents"] or not results["documents"][0]:
            return "No relevant code found."
            
        context = []
        for i, doc in enumerate(results["documents"][0]):
            meta = results["metadatas"][0][i]
            context.append(f"--- Result {i+1} ---\\nFile: {meta['file_path']}\\nFunction: {meta['function_name']}\\nLines: {meta['start_line']}-{meta['end_line']}\\n\\n{doc}\\n")
            
        return "\\n".join(context)"""

content = content.replace(
    '    def get_file_summary(self, path: str) -> str:',
    search_rag + '\n\n    def get_file_summary(self, path: str) -> str:'
)

with open("agent-backend/app/agent_memory.py", "w") as f:
    f.write(content)
