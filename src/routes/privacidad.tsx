import { createFileRoute, Link } from "@tanstack/react-router";

// Página pública de política de privacidad. Sirve dos propósitos: enlace
// visible para cualquier persona usuaria y, sobre todo, la URL que pide App
// Store Connect al configurar la ficha de la app y el cuestionario de
// privacidad para TestFlight/App Review.
export const Route = createFileRoute("/privacidad")({
  head: () => ({
    meta: [
      { title: "Política de privacidad — Peppers" },
      {
        name: "description",
        content: "Qué datos recoge Peppers, para qué los usa y cómo eliminarlos.",
      },
    ],
  }),
  component: PrivacidadPage,
});

function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Volver
      </Link>

      <h1 className="mt-6 font-display text-3xl text-foreground">Política de privacidad</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Última actualización: 23 de agosto de 2026
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="font-display text-lg">Quién trata tus datos</h2>
          <p className="mt-2 text-muted-foreground">
            Peppers es una app personal desarrollada y operada por Víctor Gorina. Para cualquier
            duda o solicitud sobre tus datos, escribe a{" "}
            <a href="mailto:cagafanta@gmail.com" className="text-primary underline">
              cagafanta@gmail.com
            </a>
            .
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg">Qué datos recogemos</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <span className="text-foreground">Cuenta:</span> correo electrónico y contraseña, o
              nombre, correo y foto de tu cuenta de Google si entras con "Continuar con Google".
            </li>
            <li>
              <span className="text-foreground">Perfil:</span> edad, altura, peso, nivel de
              actividad, objetivo, restricciones alimentarias y horario de comidas — los datos que
              rellenas en el onboarding para personalizar tu plan.
            </li>
            <li>
              <span className="text-foreground">Registro diario:</span> peso, comidas y ejercicio
              que anotas cada día, y el plan mensual de comidas que genera o ajusta la app.
            </li>
            <li>
              <span className="text-foreground">Conversaciones con el coach:</span> los mensajes que
              le escribes al asistente de IA y sus respuestas.
            </li>
            <li>
              <span className="text-foreground">Hogar:</span> si creas o te unes a un hogar
              compartido, el nombre del hogar y de sus miembros (incluidos menores, si los añade la
              persona adulta responsable de la cuenta).
            </li>
            <li>
              <span className="text-foreground">Notificaciones:</span> si las activas en la web, el
              identificador técnico de suscripción push de tu navegador.
            </li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            No recogemos datos de pago (no hay compras en la app) ni usamos cookies o SDKs de
            analítica o publicidad.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg">Para qué los usamos</h2>
          <p className="mt-2 text-muted-foreground">
            Solo para el funcionamiento de la app: generar y ajustar tu plan de comidas, mostrar tu
            progreso e historial, responder en el coach de IA y enviarte los avisos que actives. No
            vendemos ni compartimos tus datos con terceros para publicidad.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg">Con quién los compartimos</h2>
          <p className="mt-2 text-muted-foreground">
            Usamos proveedores que procesan los datos en nuestro nombre, bajo sus propias garantías
            de seguridad:
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted-foreground">
            <li>
              <span className="text-foreground">Supabase</span> — base de datos, autenticación y
              almacenamiento.
            </li>
            <li>
              <span className="text-foreground">OpenRouter / Google (Gemini)</span> — genera las
              respuestas del coach de IA a partir de tu perfil y tu conversación.
            </li>
            <li>
              <span className="text-foreground">Vercel</span> — aloja la aplicación web.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="font-display text-lg">Cuánto tiempo los guardamos</h2>
          <p className="mt-2 text-muted-foreground">
            Mientras tu cuenta exista. Puedes borrar tu cuenta y todos tus datos en cualquier
            momento desde Ajustes → Eliminar cuenta, tanto en la app móvil como en la web. El
            borrado es inmediato y no se puede deshacer.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg">Seguridad</h2>
          <p className="mt-2 text-muted-foreground">
            Toda la comunicación va cifrada (HTTPS). El acceso a tus datos está restringido por
            reglas a nivel de base de datos (Row Level Security): nadie salvo tú — o quien compartas
            expresamente tu hogar — puede leer tu información.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg">Menores</h2>
          <p className="mt-2 text-muted-foreground">
            Peppers no está dirigida a menores y no permite que un menor cree su propia cuenta. Si
            se añaden datos de un menor, es porque la persona adulta titular de la cuenta los
            introduce como parte de la planificación del hogar.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg">Cambios en esta política</h2>
          <p className="mt-2 text-muted-foreground">
            Si actualizamos esta política de forma relevante, cambiaremos la fecha de arriba. El uso
            continuado de la app tras un cambio implica que lo aceptas.
          </p>
        </section>
      </div>
    </main>
  );
}
