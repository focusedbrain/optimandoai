# Ultra-Lightweight LLM Models Guide

## Empfehlungen für sehr schwache Hardware

### 🏆 Top 3 für schwächste Systeme (sortiert nach Geschwindigkeit)

1. **Qwen2 0.5B (Q4)** - 0.4GB
   - Schnellstes Modell überhaupt
   - Nur 0.5 Milliarden Parameter
   - Perfekt für sehr alte Computer
   - Riesiges Context-Fenster (32K)

2. **TinyLlama 1.1B (Q4)** - 0.6GB
   - Ultra-schnell und zuverlässig
   - 4-bit quantisiert
   - Bewährtes Modell

3. **Gemma 2B (Q2_K)** - 0.9GB
   - 2-bit ultra-komprimiert
   - Google Qualität
   - Guter Kompromiss

### 📊 Quantisierungs-Levels erklärt

| Quantisierung | Größe | Geschwindigkeit | Qualität | RAM |
|---------------|-------|-----------------|----------|-----|
| **Q2_K** | Kleinste | Schnellste | Akzeptabel | Minimal |
| **Q3_K** | Klein | Sehr schnell | Gut | Niedrig |
| **Q4_0/Q4_K** | Mittel | Schnell | Sehr gut | Normal |
| **Q5_K** | Größer | Langsamer | Exzellent | Mehr |
| **Q8** | Groß | Langsam | Fast perfekt | Viel |

### 🚀 Installations-Befehle

```bash
# Qwen2 0.5B (Kleinste)
ollama pull qwen2:0.5b

# TinyLlama 1.1B
ollama pull tinyllama

# Gemma 2B Q4
ollama pull gemma:2b

# Gemma 2B Q2 (Ultra komprimiert)
ollama pull gemma:2b-q2_K

# StableLM 1.6B
ollama pull stablelm2:1.6b

# Phi-2 2.7B
ollama pull phi:2.7b

# Phi-3 Q2 (Ultra komprimiert)
ollama pull phi3:3.8b-q2_K
```

### 💡 Optimierte Custom Models

#### Qwen Ultra-Light
```bash
cd apps/electron-vite-project/electron/main/llm
ollama create qwen-ultralight -f Modelfile.qwen-ultralight
```

#### Gemma Low
```bash
cd apps/electron-vite-project/electron/main/llm
ollama create gemma-low -f Modelfile.gemma-low
```

### 🎯 Welches Modell für welche Hardware?

**<2GB RAM:** Qwen2 0.5B (Q4)
**2-3GB RAM:** TinyLlama, Gemma 2B (Q2_K), StableLM 1.6B
**3-4GB RAM:** Gemma 2B (Q4), Phi-2 2.7B, Phi-3 (Q2_K)
**>4GB RAM:** Phi-3 Mini (Q4), phi3-low (Custom)

### 📈 Performance-Vergleich

```
Qwen2 0.5B:      ████████████████████░ 95% speed, 70% quality
TinyLlama 1.1B:  ███████████████████░░ 90% speed, 75% quality
Gemma 2B (Q2):   ██████████████████░░░ 85% speed, 80% quality
Gemma 2B (Q4):   █████████████████░░░░ 80% speed, 85% quality
StableLM 1.6B:   █████████████████░░░░ 80% speed, 82% quality
Phi-2 2.7B:      ████████████████░░░░░ 75% speed, 87% quality
Phi-3 (Q2):      ███████████████░░░░░░ 70% speed, 88% quality
Phi-3 (Q4):      ██████████████░░░░░░░ 65% speed, 92% quality
```

### ⚙️ Empfohlene Parameter für Custom Models

**Sehr schwache Hardware (<3GB RAM):**
```
PARAMETER num_ctx 1024
PARAMETER num_batch 16
PARAMETER num_threads 2-4
```

**Schwache Hardware (3-4GB RAM):**
```
PARAMETER num_ctx 2048
PARAMETER num_batch 32
PARAMETER num_threads 4
```

**Normale Hardware (>4GB RAM):**
```
PARAMETER num_ctx 4096
PARAMETER num_batch 64-128
PARAMETER num_threads 6-8
```





