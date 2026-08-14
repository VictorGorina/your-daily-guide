# Daily Guide

App de coach de salud y alimentación. TanStack Start + React + TypeScript + Tailwind + Supabase.
La IA (chat del coach, guía diaria, plan mensual) usa OpenRouter (modelo `google/gemini-2.5-flash`
por defecto) a través de `@openrouter/ai-sdk-provider`
(ver [src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)); requiere `OPENROUTER_API_KEY` en `.env`.
