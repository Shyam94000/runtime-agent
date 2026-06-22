import asyncio
from app.config import settings
from app.llm_router import router

async def main():
    if not router.providers:
        print("No API keys configured.")
        return
        
    print(f"Testing with {router.providers[0].name}...")
    try:
        res = await asyncio.to_thread(router.generate_simple, "Say 'Hello World' exactly.")
        print(f"Text: {res.text}")
        print(f"Tokens: {res.input_tokens} input, {res.output_tokens} output, {res.total_tokens} total")
    except Exception as e:
        print(f"Error: {e}")

asyncio.run(main())
