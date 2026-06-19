const fs = require('fs');

let chatContent = fs.readFileSync('frontend/src/app/chat/page.js', 'utf8');

const streamFn = `
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Add a placeholder message for the assistant
      setMessages(prev => [...prev, { role: 'agent', content: '', streaming: true }]);
      
      const res = await fetch('http://localhost:8000/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input })
      });
      
      if (!res.ok) throw new Error('Stream failed');
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg.role === 'agent' && lastMsg.streaming) {
              lastMsg.content += chunk;
            }
            return newMessages;
          });
        }
      }
      
      // Mark as done streaming
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMsg = newMessages[newMessages.length - 1];
        if (lastMsg.role === 'agent') {
          lastMsg.streaming = false;
        }
        return newMessages;
      });
    } catch (err) {
      setMessages(prev => [...prev, { role: 'agent', content: 'Failed to reach the agent.' }]);
    } finally {
      setLoading(false);
    }
  };
`;

chatContent = chatContent.replace(/  const sendMessage = async \(e\) => \{[\s\S]*?  \};\n/m, streamFn);

fs.writeFileSync('frontend/src/app/chat/page.js', chatContent);
console.log("Frontend stream patched");
