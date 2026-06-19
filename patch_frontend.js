const fs = require('fs');

// Update api.js
let apiContent = fs.readFileSync('frontend/src/lib/api.js', 'utf8');
if (!apiContent.includes('getUsageStats')) {
    apiContent += `
export async function getUsageStats() {
  return fetchAPI('/api/usage');
}
`;
    fs.writeFileSync('frontend/src/lib/api.js', apiContent);
}

// Update chat/page.js
let chatContent = fs.readFileSync('frontend/src/app/chat/page.js', 'utf8');
chatContent = chatContent.replace(
    'setMessages(prev => [...prev, { role: "agent", content: data.content }]);',
    'setMessages(prev => [...prev, { role: "agent", content: data.content, tokens: data.tokens, model: data.model }]);'
);

chatContent = chatContent.replace(
    '              <ReactMarkdown\n                remarkPlugins={[remarkGfm]}\n                components={{\n                  code({node, inline, className, children, ...props}) {',
    `              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({node, inline, className, children, ...props}) {`
);

chatContent = chatContent.replace(
    '                }}\n              >\n                {msg.content}\n              </ReactMarkdown>\n            </div>',
    `                }}
              >
                {msg.content}
              </ReactMarkdown>
              {msg.tokens && (
                <div className="mt-2 text-xs var(--text-tertiary) flex items-center gap-1 opacity-70">
                  <span>⚡</span>
                  <span>{msg.tokens.total.toLocaleString()} tokens</span>
                  <span>·</span>
                  <span>{msg.model}</span>
                </div>
              )}
            </div>`
);
fs.writeFileSync('frontend/src/app/chat/page.js', chatContent);

// Update diagnostics/[id]/page.js
let diagContent = fs.readFileSync('frontend/src/app/diagnostics/[id]/page.js', 'utf8');

if (!diagContent.includes('Total Tokens')) {
    diagContent = diagContent.replace(
        '  const [isDiagnosing, setIsDiagnosing] = useState(false);',
        '  const [isDiagnosing, setIsDiagnosing] = useState(false);\n  const [traceData, setTraceData] = useState(null);'
    );

    diagContent = diagContent.replace(
        'import { getDiagnostic, triggerDiagnosis } from "@/lib/api";',
        'import { getDiagnostic, triggerDiagnosis, fetchAPI } from "@/lib/api";'
    );

    const effectStr = `
  useEffect(() => {
    if (report?.agent_trace_id && !traceData) {
      fetchAPI(\`/api/traces/\${report.agent_trace_id}\`)
        .then(data => setTraceData(data))
        .catch(err => console.error('Failed to fetch trace data:', err));
    }
  }, [report?.agent_trace_id, traceData]);
`;
    
    diagContent = diagContent.replace(
        '  if (error) {',
        effectStr + '\n  if (error) {'
    );

    diagContent = diagContent.replace(
        '              <div className="text-sm font-medium">{report.model_used || "unknown"}</div>\n            </div>\n          </div>',
        `              <div className="text-sm font-medium">{report.model_used || "unknown"}</div>
            </div>
            <div>
              <div className="text-xs var(--text-tertiary) mb-1 uppercase tracking-wider">Total Tokens</div>
              <div className="text-sm font-medium">{traceData?.total_tokens ? traceData.total_tokens.toLocaleString() : "—"}</div>
            </div>
            <div>
              <div className="text-xs var(--text-tertiary) mb-1 uppercase tracking-wider">Est. Cost</div>
              <div className="text-sm font-medium">{traceData?.estimated_cost_usd ? "$" + traceData.estimated_cost_usd.toFixed(4) : "—"}</div>
            </div>
          </div>`
    );
    
    fs.writeFileSync('frontend/src/app/diagnostics/[id]/page.js', diagContent);
}

console.log('Frontend patched.');
