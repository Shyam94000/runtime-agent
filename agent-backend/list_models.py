from google import genai
from app.config import settings
client = genai.Client(api_key=settings.gemini_api_key)
print([m.name for m in client.models.list()])
