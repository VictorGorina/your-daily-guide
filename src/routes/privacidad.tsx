import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

// Página pública de política de privacidad. La enlazan la pantalla de acceso,
// Ajustes › Privacidad y el paso de consentimiento de los datos de salud, en la
// web y en el móvil (que la abre en el navegador), y es la URL que pide App
// Store Connect.
//
// Versión 2026-10 (ticket 30 de la auditoría): base jurídica, encargados y
// países, plazos de retención (los aplica `20261024170200_retention.sql`) y el
// consentimiento de los datos de salud. Pendiente de revisión legal profesional:
// el borrador y sus notas están en `.scratch/auditoria-2026-09-26/`. Si cambia lo
// que se dice de los datos de salud, sube `HEALTH_CONSENT_VERSION`.
export const Route = createFileRoute("/privacidad")({
  head: () => ({
    meta: [
      { title: "Política de privacidad — Peppers" },
      {
        name: "description",
        content:
          "Qué datos trata Peppers, para qué, con qué base jurídica, quién más los trata, cuánto tiempo se guardan y tus derechos.",
      },
    ],
  }),
  component: PrivacidadPage,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg">{title}</h2>
      <div className="mt-2 space-y-2 text-muted-foreground">{children}</div>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <span className="text-foreground">{label}:</span> {children}
    </li>
  );
}

const CONTACT = "cagafanta@gmail.com";

const PROCESSORS: { name: string; what: string; where: string }[] = [
  {
    name: "Supabase",
    what: "Base de datos y autenticación.",
    where: "Unión Europea (Irlanda).",
  },
  {
    name: "Vercel",
    what: "Aloja la web y ejecuta el servidor de la app.",
    where: "Estados Unidos.",
  },
  {
    name: "OpenRouter",
    what: "Intermediario hacia los modelos de IA.",
    where: "Estados Unidos.",
  },
  {
    name: "Google (Gemini) y OpenAI (GPT)",
    what: "Los modelos de IA que preparan el plan, las recetas y las respuestas del coach, a través de OpenRouter.",
    where: "Principalmente Estados Unidos.",
  },
  {
    name: "Resend",
    what: "Envía los correos de acceso (confirmar la cuenta, cambiar la contraseña).",
    where: "Envío desde la Unión Europea; empresa en Estados Unidos.",
  },
  {
    name: "Sentry",
    what: "Registro de errores técnicos, sin tu correo ni tu nombre: solo tu identificador interno.",
    where: "Unión Europea (Alemania).",
  },
  {
    name: "Cloudflare (Turnstile)",
    what: "Comprobar que quien crea una cuenta no es un programa automático, cuando esa comprobación está activada.",
    where: "Red global; empresa en Estados Unidos.",
  },
  {
    name: "Apple o Google (tu dispositivo o tu navegador)",
    what: "Convertir tu voz en texto si usas el dictado. A Peppers solo llega el texto.",
    where: "Según tu dispositivo.",
  },
];

function PrivacidadPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Volver
      </Link>

      <h1 className="mt-6 font-display text-3xl text-foreground">Política de privacidad</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Versión 2026-10 · Última actualización: 24 de octubre de 2026
      </p>

      <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground">
        <Section title="Quién trata tus datos">
          <p>
            El responsable del tratamiento es Víctor Gorina, que desarrolla y opera Peppers. Para
            cualquier duda o solicitud sobre tus datos, escribe a{" "}
            <a href={`mailto:${CONTACT}`} className="text-primary-ink underline">
              {CONTACT}
            </a>
            .
          </p>
        </Section>

        <Section title="Qué datos tratamos">
          <ul className="list-disc space-y-1.5 pl-5">
            <Item label="Cuenta">
              correo electrónico y contraseña (la guarda cifrada el proveedor de autenticación), o
              nombre, correo y foto de tu cuenta de Google si entras con Google.
            </Item>
            <Item label="Perfil">
              nombre, fecha de nacimiento, sexo, altura, peso, actividad y rutina de ejercicio,
              objetivo, preferencias, alergias y restricciones alimentarias, presupuesto, horarios y
              el tono que prefieres para el coach.
            </Item>
            <Item label="Datos de salud, solo si das tu consentimiento">
              condiciones médicas, medicación y suplementos, embarazo o lactancia, ciclo menstrual,
              tu relación con la comida (también si tienes o has tenido un trastorno de la conducta
              alimentaria) y lo que te ha costado en intentos anteriores, la gravedad de tus
              alergias, y el consumo de alcohol y tabaco. Son una categoría especial de datos (art.
              9 del RGPD).
            </Item>
            <Item label="Registro diario">
              comidas, picoteo, deporte, peso y el plan mensual que genera o ajusta la app.
            </Item>
            <Item label="Conversaciones con el coach">tus mensajes y sus respuestas.</Item>
            <Item label="Hogar compartido">
              el nombre del hogar y de sus miembros (también menores, si los añade la persona adulta
              responsable) y lo que cada uno come de la mesa común.
            </Item>
            <Item label="Tiquets de la compra">
              la foto que subes, para leer los productos y el importe.
            </Item>
            <Item label="Notificaciones">
              si las activas, el identificador técnico de suscripción de tu navegador.
            </Item>
            <Item label="Datos técnicos">
              registros de errores y contadores de uso para limitar abusos (por cuenta, o por correo
              cifrado con una clave secreta cuando pides cambiar la contraseña).
            </Item>
          </ul>
          <p>
            No hay compras dentro de la app, y no usamos cookies ni SDKs de publicidad o analítica.
          </p>
        </Section>

        <Section title="Para qué y con qué base jurídica">
          <ul className="list-disc space-y-1.5 pl-5">
            <Item label="Prestarte el servicio (plan, compra, registro, coach, hogar y avisos)">
              la ejecución del contrato que aceptas al usar la app (art. 6.1.b del RGPD).
            </Item>
            <Item label="Usar tus datos de salud para personalizar el plan y el coach">
              tu consentimiento explícito (art. 9.2.a del RGPD), que puedes retirar cuando quieras.
            </Item>
            <Item label="Seguridad del servicio (límites de uso y registros de errores)">
              el interés legítimo en proteger la app y a quienes la usan (art. 6.1.f del RGPD).
            </Item>
          </ul>
          <p>
            Si no das el consentimiento para los datos de salud, la app funciona igual sin ellos: no
            se te preguntan y el plan se hace sin esa información. Si lo retiras, se borran de tu
            perfil en ese momento. No vendemos tus datos ni los usamos para publicidad.
          </p>
        </Section>

        <Section title="Quién más los trata">
          <p>
            Estos proveedores tratan datos en nuestro nombre (encargados del tratamiento), solo para
            lo que se indica:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            {PROCESSORS.map((p) => (
              <li key={p.name}>
                <span className="text-foreground">{p.name}</span> — {p.what} {p.where}
              </li>
            ))}
          </ul>
          <p>
            A la IA llega lo necesario para cada respuesta: tu perfil (con los datos de salud solo
            si diste el consentimiento) y la conversación, nunca tu correo.
          </p>
          <p>
            Cuando un proveedor trata datos fuera del Espacio Económico Europeo, la transferencia se
            ampara en el Marco de Privacidad de Datos UE-EE. UU., si el proveedor está adherido, o
            en las cláusulas contractuales tipo de la Comisión Europea que incluyen sus condiciones
            de tratamiento de datos.
          </p>
        </Section>

        <Section title="Cuánto tiempo los guardamos">
          <ul className="list-disc space-y-1.5 pl-5">
            <Item label="Conversaciones con el coach">180 días.</Item>
            <Item label="Contadores de uso e intentos de unirse a un hogar">7 días.</Item>
            <Item label="Gasto en IA por día (sin contenido)">400 días.</Item>
            <Item label="Cuentas sin registrar (el modo de probar sin cuenta)">
              se borran solas tras 30 días sin usarse.
            </Item>
            <Item label="Perfil, registro diario, planes y hogar">
              mientras exista tu cuenta: son el historial que ves en la app.
            </Item>
          </ul>
          <p>
            Puedes borrar tu cuenta y todos tus datos cuando quieras desde Ajustes → Eliminar
            cuenta, en la app y en la web. El borrado es inmediato y no se puede deshacer.
          </p>
        </Section>

        <Section title="Tus derechos">
          <p>
            Puedes pedir acceso a tus datos, rectificarlos, suprimirlos, oponerte a su tratamiento o
            limitarlo, y llevártelos (portabilidad). Casi todo lo puedes hacer tú en la app:
            corregir tus respuestas en Ajustes → Mis respuestas, descargar tu historial en Ajustes →
            Datos y cuenta, y retirar el consentimiento de los datos de salud en Ajustes →
            Privacidad → «Usar mis datos de salud». Para lo demás, escribe a{" "}
            <a href={`mailto:${CONTACT}`} className="text-primary-ink underline">
              {CONTACT}
            </a>
            ; contestamos en un mes como máximo.
          </p>
          <p>
            Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de
            Protección de Datos (
            <a href="https://www.aepd.es" className="text-primary-ink underline">
              www.aepd.es
            </a>
            ).
          </p>
        </Section>

        <Section title="Seguridad">
          <p>
            Toda la comunicación va cifrada (HTTPS). El acceso a tus datos está restringido por
            reglas en la base de datos: nadie salvo tú puede leer tu información, y quien comparte
            hogar contigo solo ve lo del hogar. Hay límites de uso contra abusos.
          </p>
        </Section>

        <Section title="Menores">
          <p>
            Peppers está pensada para personas adultas. Si se añaden datos de un menor, es porque la
            persona adulta responsable los introduce como parte de la planificación de su hogar.
          </p>
        </Section>

        <Section title="Cambios en esta política">
          <p>
            Si cambiamos esta política de forma relevante, cambiará la versión de arriba. Si cambia
            lo que se hace con tus datos de salud, la app te volverá a pedir el consentimiento.
          </p>
        </Section>
      </div>
    </main>
  );
}
