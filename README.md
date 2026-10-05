# Peppers

Tu coach diario de alimentación: un plan de comidas para el mes, pensado a partir de una
conversación con el coach, una guía para cada día y la lista de la compra que sale de ese plan.
Cuando comes distinto, picoteas o haces deporte, la app recoloca los próximos días para que el
conjunto siga cuadrando con tu objetivo, y te enseña qué ha movido y por qué.

> **Cómo se calculan las cifras.** Las kcal y macros de cada plato se calculan **en código** a
> partir de su receta: la IA solo propone la composición del plato (ingredientes y gramos en
> crudo) y el código pone las cifras con una tabla de composición de alimentos, la grasa según el
> método de cocción y la ración que te corresponde. El objetivo diario también se calcula en
> código (Mifflin-St Jeor y tu actividad), no lo decide el modelo.
>
> Peppers no sustituye el consejo de un profesional médico ni de la nutrición.

## Desarrollo

Necesitas [Bun](https://bun.sh) (la versión está fijada en `.bun-version`).

```sh
bun install        # dependencias
bun run dev        # servidor de desarrollo, http://localhost:8080
bun run build      # build de producción
bun run lint       # ESLint
bun run typecheck  # TypeScript
bun run test       # tests de la lógica pura
bun run format     # Prettier
```

Copia `.env.example` a `.env` y rellénalo con tus propias claves (Supabase, `OPENROUTER_API_KEY`
para el coach, VAPID y `CRON_SECRET` para las notificaciones). Cada variable lleva al lado un
comentario que dice para qué sirve y si es opcional.

### App móvil

La app de iOS vive en [`mobile/`](mobile/): Expo / React Native, gestionada con **npm** (Metro no
corre sobre Bun). Llama a la misma API que la web (`/api/v1/*`). Antes de tocarla, lee
[mobile/AGENTS.md](mobile/AGENTS.md).

```sh
cd mobile
npm install
npx expo run:ios
```

### Base de datos

Supabase (Postgres con RLS y Auth). Las migraciones están en
[`supabase/migrations/`](supabase/migrations/) y se aplican con la CLI de Supabase
(`supabase db push`, siempre tras `--dry-run`); después, `bun run db:types` regenera los tipos de
las dos apps. El flujo completo está en [docs/agents/verification.md](docs/agents/verification.md).

## Documentación

- [CLAUDE.md](CLAUDE.md): arquitectura y las reglas que un cambio no debe romper.
- [AGENTS.md](AGENTS.md): el detalle, con el porqué de cada decisión.
- [docs/](docs/): guía de diseño, cómo se verifica un cambio y cómo se prueban las cosas.

## Construido con

- [TanStack Start](https://tanstack.com/start) (React 19 con SSR) y TypeScript
- Tailwind CSS v4 y shadcn/ui
- [Supabase](https://supabase.com)
- [OpenRouter](https://openrouter.ai) (Gemini 2.5 Flash para el coach, Gemini 2.5 Pro para el plan
  y GPT-5 para descomponer los platos)
- Desplegada en [Vercel](https://vercel.com)
