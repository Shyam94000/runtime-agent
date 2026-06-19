import re

with open("agent-backend/app/monitor.py", "r") as f:
    content = f.read()

# Replace storage import
content = content.replace("from app.storage import JsonStore", "from app.database import SQLiteStore")

# Update store initialization
content = content.replace("self.store = JsonStore()", "self.store = SQLiteStore()")

# Replace load
load_code = """        # Load persistent data
        self.anomalies, self.diagnostics, self.agent_traces = self.store.load_all()"""
content = re.sub(r'        # Load persistent data\n        data = self\.store\.load\(\)\n        self\.anomalies = data\.get\("anomalies", \[\]\)\n        self\.diagnostics = data\.get\("diagnostics", \[\]\)\n        self\.agent_traces = data\.get\("traces", \[\]\)', load_code, content)

# Update _save method to save_all since that matches the current JsonStore signature roughly, but SQLite saves incrementally usually.
# In monitor.py, _save() was doing self.store.save(self.anomalies, self.diagnostics, self.agent_traces)
save_code = """    def _save(self):
        try:
            self.store.save_all(self.anomalies, self.diagnostics, self.agent_traces)
        except Exception as e:
            self.logger.error(f"Failed to save data: {e}")"""
content = re.sub(r'    def _save\(self\):\n        try:\n            self\.store\.save\(self\.anomalies, self\.diagnostics, self\.agent_traces\)\n        except Exception as e:\n            self\.logger\.error\(f"Failed to save data: \{e\}"\)', save_code, content)


with open("agent-backend/app/monitor.py", "w") as f:
    f.write(content)
