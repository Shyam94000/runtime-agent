"""LLM pricing lookup for cost estimation."""

# Pricing per 1M tokens (USD) — updated June 2025
PRICING = {
    # Gemini models
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-2.0-flash-lite": {"input": 0.075, "output": 0.30},
    "gemini-2.5-flash": {"input": 0.15, "output": 0.60},
    "gemini-2.5-pro": {"input": 1.25, "output": 10.00},
    "gemini-3.1-flash-lite": {"input": 0.075, "output": 0.30},
    # DeepSeek models (via NVIDIA NIM / OpenRouter)
    "deepseek-ai/deepseek-v4-flash": {"input": 0.20, "output": 0.60},
    "deepseek/deepseek-v4-flash": {"input": 0.20, "output": 0.60},
    "deepseek-ai/deepseek-r1": {"input": 0.55, "output": 2.19},
}

# Fallback pricing for unknown models
DEFAULT_PRICING = {"input": 0.50, "output": 1.50}


def estimate_cost(model_name: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate the cost in USD for a given LLM call.

    Args:
        model_name: The model identifier string.
        input_tokens: Number of input/prompt tokens.
        output_tokens: Number of output/completion tokens.

    Returns:
        Estimated cost in USD.
    """
    pricing = PRICING.get(model_name, DEFAULT_PRICING)
    cost = (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000
    return round(cost, 6)
