import asyncio
import json
from google import genai
from google.genai import types
from app.config import settings
from app.agent_tools import create_tools

class DummyContext:
    def __init__(self):
        self.source_path = settings.source_path
        self.monitor = None
        self.memory = None

def main():
    tools = create_tools(DummyContext())
    client = genai.Client(api_key=settings.gemini_api_key)
    
    chat_history = [
        types.Content(
            role="user",
            parts=[types.Part.from_text(text="Please call the list_source_files tool.")]
        )
    ]
    
    config = types.GenerateContentConfig(
        tools=tools,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )
    
    print("Calling API first time...")
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=chat_history,
        config=config,
    )
    
    candidate = response.candidates[0]
    print("Candidate parts:", candidate.content.parts)
    
    for part in candidate.content.parts:
        if hasattr(part, 'function_call') and part.function_call:
            fc = part.function_call
            print("Function called:", fc.name)
            
            chat_history.append(candidate.content)
            chat_history.append(
                types.Content(
                    role="user",
                    parts=[types.Part.from_function_response(
                        name=fc.name,
                        response={"result": "file1.js, file2.js"},
                    )],
                )
            )
            print("Calling API second time...")
            response2 = client.models.generate_content(
                model=settings.gemini_model,
                contents=chat_history,
                config=config,
            )
            print("Second response parts:", response2.candidates[0].content.parts)

main()
