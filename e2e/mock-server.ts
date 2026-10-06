import { startMockOpenRouter } from "./mock-openrouter";

// Entrada de `playwright.config.ts`: deja el OpenRouter de mentira escuchando
// mientras dura el smoke.
const port = Number(process.env.MOCK_OPENROUTER_PORT ?? 4010);
await startMockOpenRouter(port);
console.log(`[mock-openrouter] http://127.0.0.1:${port}`);
