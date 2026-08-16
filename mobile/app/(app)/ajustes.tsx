import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { AlertCircle, ChevronRight, Info, Pencil, Users } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav } from "../../components/bottom-nav";
import { apiPost } from "../../lib/api";
import { fetchProfile, saveProfile, type Profile } from "../../lib/daily";
import { supabase } from "../../lib/supabase";

// Nota de portado (ver AGENTS.md de mobile/): respecto a la pantalla web se
// omiten dos secciones que aún no aplican en nativo:
//  - "Notificaciones" (Web Push VAPID): el push nativo va con expo-notifications,
//    diferido en el plan; se añadirá al enganchar una pantalla autenticada.
//  - "Apariencia / Tema": la app nativa usa una paleta fija (no hay theming en
//    runtime como en la web). El campo `theme` del perfil se deja intacto.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function Ajustes() {
  const qc = useQueryClient();
  const router = useRouter();
  const profileQ = useQuery({ queryKey: ["profile"], queryFn: fetchProfile });
  const profile = profileQ.data;

  const save = useMutation({
    mutationFn: (patch: Partial<Profile>) => saveProfile(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
    onError: () => Alert.alert("No hemos podido guardar"),
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const setError = (key: string, message?: string) =>
    setErrors((e) => {
      const next = { ...e };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  const commitNumber = (
    key: "current_weight_kg" | "height_cm" | "goal_amount",
    raw: string,
    min: number,
    max: number,
    message: string,
    required: boolean,
  ) => {
    const text = raw.trim();
    if (!text) {
      if (required) {
        setError(key, "Este dato es necesario para tu progreso");
        return;
      }
      setError(key);
      save.mutate({ [key]: null } as Partial<Profile>);
      return;
    }
    const n = Number(text.replace(",", "."));
    if (!Number.isFinite(n) || n < min || n > max) {
      setError(key, message);
      return;
    }
    setError(key);
    save.mutate({ [key]: n } as Partial<Profile>);
  };

  const commitTime = (key: "morning_time" | "evening_time", raw: string) => {
    if (!TIME_RE.test(raw)) {
      setError(key, "Indica una hora válida (HH:MM)");
      return;
    }
    setError(key);
    save.mutate({ [key]: raw } as Partial<Profile>);
  };

  const missing = [
    profile && !profile.current_weight_kg ? "peso actual" : null,
    profile && !profile.height_cm ? "altura" : null,
    profile && !profile.morning_time ? "hora del resumen matutino" : null,
    profile && !profile.evening_time ? "hora del repaso nocturno" : null,
  ].filter(Boolean) as string[];

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    // El guardia de (app)/_layout redirige a /auth al quedarse sin sesión.
  };

  const [deleting, setDeleting] = useState(false);
  const removeAccount = async () => {
    setDeleting(true);
    try {
      await apiPost<{ ok: true }>("account/delete");
      await qc.cancelQueries();
      qc.clear();
      await supabase.auth.signOut();
    } catch (error) {
      Alert.alert(error instanceof Error ? error.message : "No hemos podido eliminar tu cuenta");
    } finally {
      setDeleting(false);
    }
  };

  const confirmDelete = () =>
    Alert.alert(
      "¿Eliminar tu cuenta?",
      "Se borrará tu perfil, tus guías, tu plan y tu progreso. Es permanente y no se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Sí, eliminar", style: "destructive", onPress: () => void removeAccount() },
      ],
    );

  const inputClass =
    "h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm text-foreground";
  // `key` fuerza a remontar los inputs no controlados cuando llega el perfil,
  // para que `defaultValue` refleje el dato guardado y no quede en blanco.
  const seed = profile?.id ?? "loading";

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg px-5 pb-36 pt-6"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-3xl font-semibold text-foreground">Ajustes</Text>

        {missing.length ? (
          <View className="mt-4 flex-row items-start gap-2 rounded-2xl border border-primary/30 bg-primary-soft px-4 py-3">
            <Info size={16} color="#4f8ac6" style={{ marginTop: 1 }} />
            <Text className="flex-1 text-xs text-foreground">
              Para que el progreso y los avisos funcionen bien, completa: {missing.join(", ")}.
            </Text>
          </View>
        ) : null}

        {/* Cuenta */}
        <Text className="mt-6 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Cuenta
        </Text>
        <View className="mt-2 overflow-hidden rounded-3xl border border-border bg-surface">
          <Pressable
            onPress={() => router.navigate("/hogar")}
            className="flex-row items-center gap-3 border-b border-border px-4 py-4 active:opacity-70"
          >
            <Users size={16} color="#4f8ac6" />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-medium text-foreground">Tu hogar</Text>
              <Text className="text-xs text-muted-foreground">
                Une cuentas, elige qué comidas compartís y añade a los peques
              </Text>
            </View>
            <ChevronRight size={16} color="#677380" />
          </Pressable>
          <Pressable
            onPress={() => router.navigate("/perfil")}
            className="flex-row items-center gap-3 px-4 py-4 active:opacity-70"
          >
            <Pencil size={16} color="#4f8ac6" />
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-medium text-foreground">Editar mis respuestas</Text>
              <Text className="text-xs text-muted-foreground">
                Corrige cualquier dato del onboarding en dos toques
              </Text>
            </View>
            <ChevronRight size={16} color="#677380" />
          </Pressable>
        </View>

        {/* Perfil — datos básicos */}
        <Text className="mt-6 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Perfil
        </Text>
        <View className="mt-2 gap-4 rounded-3xl border border-border bg-surface p-5">
          <Text className="text-sm font-semibold text-foreground">Datos básicos</Text>
          <TextInput
            key={`name-${seed}`}
            defaultValue={profile?.display_name ?? ""}
            placeholder="Nombre"
            placeholderTextColor="#9aa5b1"
            onEndEditing={(e) => save.mutate({ display_name: e.nativeEvent.text || null })}
            className={inputClass}
          />
          <View className="flex-row gap-3">
            <View className="flex-1">
              <TextInput
                key={`weight-${seed}`}
                defaultValue={profile?.current_weight_kg?.toString() ?? ""}
                placeholder="Peso (kg)"
                placeholderTextColor="#9aa5b1"
                keyboardType="decimal-pad"
                onEndEditing={(e) =>
                  commitNumber(
                    "current_weight_kg",
                    e.nativeEvent.text,
                    25,
                    350,
                    "El peso debe estar entre 25 y 350 kg",
                    true,
                  )
                }
                className={inputClass}
              />
              <FieldNote error={errors["current_weight_kg"]} help="Necesario para tu progreso." />
            </View>
            <View className="flex-1">
              <TextInput
                key={`height-${seed}`}
                defaultValue={profile?.height_cm?.toString() ?? ""}
                placeholder="Altura (cm)"
                placeholderTextColor="#9aa5b1"
                keyboardType="decimal-pad"
                onEndEditing={(e) =>
                  commitNumber(
                    "height_cm",
                    e.nativeEvent.text,
                    100,
                    250,
                    "La altura debe estar entre 100 y 250 cm",
                    true,
                  )
                }
                className={inputClass}
              />
              <FieldNote error={errors["height_cm"]} help="Ajusta las cantidades de tu guía." />
            </View>
          </View>
          <View>
            <TextInput
              key={`goal-${seed}`}
              defaultValue={profile?.goal_amount?.toString() ?? ""}
              placeholder="Objetivo (kg)"
              placeholderTextColor="#9aa5b1"
              keyboardType="decimal-pad"
              onEndEditing={(e) =>
                commitNumber(
                  "goal_amount",
                  e.nativeEvent.text,
                  0.5,
                  100,
                  "El objetivo debe estar entre 0,5 y 100 kg",
                  false,
                )
              }
              className={inputClass}
            />
            <FieldNote
              error={errors["goal_amount"]}
              help="Opcional: kg que quieres perder o ganar."
            />
          </View>
        </View>

        {/* Coach */}
        <Text className="mt-6 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Coach
        </Text>
        <View className="mt-2 gap-4 rounded-3xl border border-border bg-surface p-5">
          <View>
            <Text className="text-sm font-semibold text-foreground">Tono</Text>
            <View className="mt-3 flex-row gap-2">
              {["relajado", "neutro", "exigente"].map((t) => {
                const active = profile?.tone === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => save.mutate({ tone: t })}
                    className={`flex-1 items-center rounded-2xl border px-3 py-3 active:opacity-80 ${
                      active ? "border-primary bg-primary-soft" : "border-input bg-surface"
                    }`}
                  >
                    <Text
                      className={`text-sm capitalize ${active ? "text-primary" : "text-foreground"}`}
                    >
                      {t}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="border-t border-border pt-4">
            <Text className="text-sm font-semibold text-foreground">Recordatorios</Text>
            <View className="mt-3 flex-row gap-3">
              <View className="flex-1">
                <Text className="text-xs text-muted-foreground">Mañana</Text>
                <TextInput
                  key={`morning-${seed}`}
                  defaultValue={profile?.morning_time?.slice(0, 5) ?? "08:00"}
                  placeholder="HH:MM"
                  placeholderTextColor="#9aa5b1"
                  keyboardType="numbers-and-punctuation"
                  onEndEditing={(e) => commitTime("morning_time", e.nativeEvent.text)}
                  className={`${inputClass} mt-1`}
                />
                <FieldNote error={errors["morning_time"]} help="Hora del resumen matutino." />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-muted-foreground">Noche</Text>
                <TextInput
                  key={`evening-${seed}`}
                  defaultValue={profile?.evening_time?.slice(0, 5) ?? "21:30"}
                  placeholder="HH:MM"
                  placeholderTextColor="#9aa5b1"
                  keyboardType="numbers-and-punctuation"
                  onEndEditing={(e) => commitTime("evening_time", e.nativeEvent.text)}
                  className={`${inputClass} mt-1`}
                />
                <FieldNote error={errors["evening_time"]} help="Hora del repaso nocturno." />
              </View>
            </View>
          </View>
        </View>

        {/* Datos y cuenta */}
        <Text className="mt-6 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Datos y cuenta
        </Text>
        <Pressable
          onPress={() => void signOut()}
          className="mt-2 w-full items-center rounded-full border border-input py-4 active:opacity-80"
        >
          <Text className="text-sm font-medium text-muted-foreground">Cerrar sesión</Text>
        </Pressable>
        <Pressable
          onPress={confirmDelete}
          disabled={deleting}
          className="mt-3 w-full items-center rounded-full border border-destructive/30 py-4 active:opacity-80"
        >
          <Text className="text-sm font-medium text-destructive">
            {deleting ? "Eliminando..." : "Eliminar cuenta"}
          </Text>
        </Pressable>
      </ScrollView>

      <BottomNav />
    </SafeAreaView>
  );
}

function FieldNote({ error, help }: { error?: string; help: string }) {
  if (error)
    return (
      <View className="mt-1 flex-row items-start gap-1">
        <AlertCircle size={12} color="#d24c49" style={{ marginTop: 2 }} />
        <Text className="flex-1 text-[11px] text-destructive">{error}</Text>
      </View>
    );
  return <Text className="mt-1 text-[11px] text-muted-foreground">{help}</Text>;
}
