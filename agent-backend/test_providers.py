"""
Manual test script for all LLM provider API keys.
Tests: Gemini, OpenCode Zen, NVIDIA NIM, OpenRouter — all with DeepSeek V4 Flash fallbacks.

Run: python test_providers.py
"""

import os
import sys
import time

# Load .env
from dotenv import load_dotenv
load_dotenv()

TEST_PROMPT = "What is 2 + 2? Answer in one word."

RESULTS = []


def test_gemini(key_name, api_key, model):
    """Test a Gemini API key."""
    print(f"\n{'='*60}")
    print(f"Testing: {key_name}")
    print(f"  Model: {model}")
    print(f"  Key:   {api_key[:12]}...{api_key[-4:]}")
    print(f"{'='*60}")

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        start = time.time()
        response = client.models.generate_content(
            model=model,
            contents=TEST_PROMPT,
            config=types.GenerateContentConfig(
                response_mime_type="text/plain",
            ),
        )
        elapsed = time.time() - start
        text = response.text.strip() if response.text else "(empty)"
        print(f"  [OK] SUCCESS ({elapsed:.2f}s)")
        print(f"  Response: {text}")
        RESULTS.append((key_name, "OK PASS", f"{elapsed:.2f}s", text[:50]))
    except Exception as e:
        print(f"  [FAIL] FAILED: {str(e)[:200]}")
        RESULTS.append((key_name, "XX FAIL", "-", str(e)[:50]))


def test_openai_compatible(key_name, api_key, base_url, model, headers=None):
    """Test an OpenAI-compatible API."""
    print(f"\n{'='*60}")
    print(f"Testing: {key_name}")
    print(f"  Model:    {model}")
    print(f"  Base URL: {base_url}")
    print(f"  Key:      {api_key[:12]}...{api_key[-4:]}")
    print(f"{'='*60}")

    try:
        from openai import OpenAI

        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            default_headers=headers,
        )
        start = time.time()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "user", "content": TEST_PROMPT}
            ],
            max_tokens=50,
        )
        elapsed = time.time() - start
        text = response.choices[0].message.content.strip() if response.choices[0].message.content else "(empty)"
        print(f"  [OK] SUCCESS ({elapsed:.2f}s)")
        print(f"  Response: {text}")
        RESULTS.append((key_name, "OK PASS", f"{elapsed:.2f}s", text[:50]))
    except Exception as e:
        print(f"  [FAIL] FAILED: {str(e)[:200]}")
        RESULTS.append((key_name, "XX FAIL", "-", str(e)[:50]))


def main():
    print("=" * 60)
    print("  LLM Provider API Key Test Suite")
    print("=" * 60)

    # --- Gemini ---
    key1 = os.getenv("GEMINI_API_KEY", "")
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    if key1:
        test_gemini("Gemini", key1, model)
    else:
        print("\n[SKIP] GEMINI_API_KEY not set")
        RESULTS.append(("Gemini", "-- SKIP", "-", "No key"))

    # --- OpenCode Zen ---
    zen_key = os.getenv("OPENCODE_ZEN_API_KEY", "")
    zen_model = os.getenv("OPENCODE_ZEN_MODEL", "deepseek-v4-flash")
    if zen_key:
        test_openai_compatible(
            "OpenCode Zen (DeepSeek V4 Flash)",
            zen_key,
            "https://opencode.ai/zen/v1",
            zen_model,
        )
    else:
        print("\n[SKIP] OPENCODE_ZEN_API_KEY not set")
        RESULTS.append(("OpenCode Zen", "-- SKIP", "-", "No key"))

    # --- NVIDIA NIM ---
    nim_key = os.getenv("NVIDIA_NIM_API_KEY", "")
    nim_model = os.getenv("NVIDIA_NIM_MODEL", "deepseek-ai/deepseek-v4-flash")
    if nim_key:
        test_openai_compatible(
            "NVIDIA NIM (DeepSeek V4 Flash)",
            nim_key,
            "https://integrate.api.nvidia.com/v1",
            nim_model,
        )
    else:
        print("\n[SKIP] NVIDIA_NIM_API_KEY not set")
        RESULTS.append(("NVIDIA NIM", "-- SKIP", "-", "No key"))

    # --- OpenRouter ---
    or_key = os.getenv("OPENROUTER_API_KEY", "")
    or_model = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash")
    if or_key:
        test_openai_compatible(
            "OpenRouter (DeepSeek V4 Flash)",
            or_key,
            "https://openrouter.ai/api/v1",
            or_model,
            headers={
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Runtime Agent Test",
            },
        )
    else:
        print("\n[SKIP] OPENROUTER_API_KEY not set")
        RESULTS.append(("OpenRouter", "-- SKIP", "-", "No key"))

    # --- Summary ---
    print(f"\n\n{'='*60}")
    print("  RESULTS SUMMARY")
    print(f"{'='*60}")
    print(f"  {'Provider':<36} {'Status':<10} {'Time':<8} {'Response'}")
    print(f"  {'-'*36} {'-'*10} {'-'*8} {'-'*20}")
    for name, status, elapsed, response in RESULTS:
        print(f"  {name:<36} {status:<10} {elapsed:<8} {response}")
    print()

    failed = sum(1 for _, s, _, _ in RESULTS if "FAIL" in s)
    if failed:
        print(f"  [!] {failed} provider(s) failed!")
        sys.exit(1)
    else:
        print("  [SUCCESS] All configured providers working!")


if __name__ == "__main__":
    main()
