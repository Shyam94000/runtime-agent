import sqlite3
import json
import os
from pathlib import Path
from pydantic import TypeAdapter
from typing import List, Tuple
from app.models import AnomalyEvent, DiagnosticReport, AgentTrace, FixRecord
from app.config import settings

class SQLiteStore:
    def __init__(self, db_path: str = "./data/runtime-monitor.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
        self._migrate_from_json()

    def _get_connection(self):
        return sqlite3.connect(self.db_path)

    def _init_db(self):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # Anomalies table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS anomalies (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT,
                    type TEXT,
                    severity TEXT,
                    status TEXT,
                    data JSON
                )
            ''')
            # Diagnostics table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS diagnostics (
                    id TEXT PRIMARY KEY,
                    anomaly_id TEXT,
                    timestamp TEXT,
                    data JSON
                )
            ''')
            # Traces table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS traces (
                    id TEXT PRIMARY KEY,
                    anomaly_id TEXT,
                    started_at TEXT,
                    data JSON
                )
            ''')
            # Fixes table
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS fixes (
                    id TEXT PRIMARY KEY,
                    created_at TEXT,
                    data JSON
                )
            ''')
            # Create indices for faster lookups
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_anomalies_timestamp ON anomalies(timestamp DESC)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostics_timestamp ON diagnostics(timestamp DESC)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces(started_at DESC)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_diagnostics_anomaly_id ON diagnostics(anomaly_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_traces_anomaly_id ON traces(anomaly_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_fixes_created_at ON fixes(created_at DESC)')
            conn.commit()

    def _migrate_from_json(self):
        json_path = Path("./data/runtime-monitor.json")
        if not json_path.exists() or self._get_count("anomalies") > 0:
            return

        print("[SQLiteStore] Migrating data from JSON to SQLite...")
        try:
            with open(json_path, "r") as f:
                data = json.load(f)
            
            anomalies = TypeAdapter(List[AnomalyEvent]).validate_python(data.get("anomalies", []))
            diagnostics = TypeAdapter(List[DiagnosticReport]).validate_python(data.get("diagnostics", []))
            traces = TypeAdapter(List[AgentTrace]).validate_python(data.get("traces", []))
            
            self.save_all(anomalies, diagnostics, traces)
            print("[SQLiteStore] Migration complete. Renaming JSON file to .bak")
            os.rename(json_path, str(json_path) + ".bak")
        except Exception as e:
            print(f"[SQLiteStore] Migration failed: {e}")

    def _get_count(self, table: str) -> int:
        with self._get_connection() as conn:
            return conn.cursor().execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    def load_all(self) -> Tuple[List[AnomalyEvent], List[DiagnosticReport], List[AgentTrace], List[FixRecord]]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            
            # Load anomalies (last 200)
            cursor.execute('SELECT data FROM anomalies ORDER BY timestamp DESC LIMIT 200')
            anomalies_data = [json.loads(row[0]) for row in cursor.fetchall()]
            anomalies = TypeAdapter(List[AnomalyEvent]).validate_python(anomalies_data)
            
            # Load diagnostics (last 200)
            cursor.execute('SELECT data FROM diagnostics ORDER BY timestamp DESC LIMIT 200')
            diagnostics_data = [json.loads(row[0]) for row in cursor.fetchall()]
            diagnostics = TypeAdapter(List[DiagnosticReport]).validate_python(diagnostics_data)
            
            # Load traces (last 100)
            cursor.execute('SELECT data FROM traces ORDER BY started_at DESC LIMIT 100')
            traces_data = [json.loads(row[0]) for row in cursor.fetchall()]
            traces = TypeAdapter(List[AgentTrace]).validate_python(traces_data)

            # Load fixes (last 100)
            cursor.execute('SELECT data FROM fixes ORDER BY created_at DESC LIMIT 100')
            fixes_data = [json.loads(row[0]) for row in cursor.fetchall()]
            fixes = TypeAdapter(List[FixRecord]).validate_python(fixes_data)
            
            return anomalies, diagnostics, traces, fixes

    def save_anomaly(self, anomaly: AnomalyEvent):
        data_json = anomaly.model_dump_json()
        with self._get_connection() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO anomalies (id, timestamp, type, severity, status, data) VALUES (?, ?, ?, ?, ?, ?)',
                (anomaly.id, anomaly.timestamp.isoformat(), anomaly.type.value, anomaly.severity, anomaly.status, data_json)
            )

    def save_diagnostic(self, diagnostic: DiagnosticReport):
        data_json = diagnostic.model_dump_json()
        with self._get_connection() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO diagnostics (id, anomaly_id, timestamp, data) VALUES (?, ?, ?, ?)',
                (diagnostic.id, diagnostic.anomaly_id, diagnostic.timestamp.isoformat(), data_json)
            )

    def save_trace(self, trace: AgentTrace):
        data_json = trace.model_dump_json()
        with self._get_connection() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO traces (id, anomaly_id, started_at, data) VALUES (?, ?, ?, ?)',
                (trace.id, trace.anomaly_id, trace.started_at.isoformat(), data_json)
            )

    def save_fix(self, fix: FixRecord):
        data_json = fix.model_dump_json()
        with self._get_connection() as conn:
            conn.execute(
                'INSERT OR REPLACE INTO fixes (id, created_at, data) VALUES (?, ?, ?)',
                (fix.id, fix.createdAt.isoformat(), data_json)
            )

    def delete_fix(self, fix_id: str):
        with self._get_connection() as conn:
            conn.execute('DELETE FROM fixes WHERE id = ?', (fix_id,))

    def save_all(self, anomalies: List[AnomalyEvent], diagnostics: List[DiagnosticReport], traces: List[AgentTrace], fixes: List[FixRecord] = None):
        with self._get_connection() as conn:
            cursor = conn.cursor()
            for anomaly in anomalies:
                cursor.execute(
                    'INSERT OR REPLACE INTO anomalies (id, timestamp, type, severity, status, data) VALUES (?, ?, ?, ?, ?, ?)',
                    (anomaly.id, anomaly.timestamp.isoformat(), anomaly.type.value, anomaly.severity, anomaly.status, anomaly.model_dump_json())
                )
            for diag in diagnostics:
                cursor.execute(
                    'INSERT OR REPLACE INTO diagnostics (id, anomaly_id, timestamp, data) VALUES (?, ?, ?, ?)',
                    (diag.id, diag.anomaly_id, diag.timestamp.isoformat(), diag.model_dump_json())
                )
            if traces:
                for trace in traces:
                    cursor.execute(
                        'INSERT OR REPLACE INTO traces (id, anomaly_id, started_at, data) VALUES (?, ?, ?, ?)',
                        (trace.id, trace.anomaly_id, trace.started_at.isoformat(), trace.model_dump_json())
                    )
            if fixes:
                for fix in fixes:
                    cursor.execute(
                        'INSERT OR REPLACE INTO fixes (id, created_at, data) VALUES (?, ?, ?)',
                        (fix.id, fix.createdAt.isoformat(), fix.model_dump_json())
                    )
            conn.commit()
