# Creating phi3-low Model

## 1. Modelfile Content

```
FROM phi3:3.8b-q4_K_M

PARAMETER num_ctx 1024
PARAMETER num_batch 16
PARAMETER num_threads 4
PARAMETER temperature 0.7

SYSTEM You are a helpful AI assistant optimized for low-resource systems.
```

## 2. Create Command

First, ensure the base model is installed:
```bash
ollama pull phi3:3.8b-q4_K_M
```

Then create the custom model:
```bash
ollama create phi3-low -f Modelfile.phi3-low
```

## 3. Test Generate Call

```json
{
  "model": "phi3-low",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false,
  "options": {
    "num_ctx": 1024,
    "num_batch": 16,
    "num_threads": 4
  }
}
```

## 4. HTTP API Example

```bash
curl http://127.0.0.1:11434/api/chat -d '{
  "model": "phi3-low",
  "messages": [
    {"role": "user", "content": "Hello!"}
  ],
  "stream": false
}'
```

## Parameters Explained

- **num_ctx: 1024** - Context window size (default 4096, reduced for speed)
- **num_batch: 16** - Batch size for processing (default 512, much smaller for low RAM)
- **num_threads: 4** - CPU threads to use (adjust based on your CPU cores)
- **temperature: 0.7** - Response randomness (0-1, lower = more deterministic)

## Notes

- This configuration uses ~60-70% less RAM than default Phi-3
- Response quality may be slightly lower but much faster
- Works well on systems with 4GB RAM or less

