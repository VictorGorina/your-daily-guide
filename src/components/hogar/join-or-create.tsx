import { ShieldCheck, Users } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OpenSlot } from "@/lib/household";
import { personColor } from "@/lib/household-shared";
import type { useHouseholdMutations } from "@/lib/use-household-mutations";

type Mutations = ReturnType<typeof useHouseholdMutations>;

const input =
  "h-12 w-full rounded-2xl bg-muted px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40";

/**
 * Sin hogar todavía: unirse con el código de alguien (que enseña los huecos
 * libres de esa mesa) o crear uno propio. El código tecleado y los huecos
 * encontrados viven aquí.
 */
export function JoinOrCreateHousehold({
  create,
  lookup,
  claim,
}: {
  create: Mutations["create"];
  lookup: Mutations["lookup"];
  claim: Mutations["claim"];
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => t("hogar.create.defaultName"));
  const [code, setCode] = useState("");
  const [slots, setSlots] = useState<OpenSlot[] | null>(null);
  return (
    <>
      <h1 className="font-title text-[34px] font-semibold tracking-[-0.03em]">
        {t("hogar.title")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("hogar.intro")}</p>

      <section className="mt-6 rounded-[1.25rem] bg-primary-soft p-5">
        <h2 className="text-sm font-semibold">{t("hogar.join.title")}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("hogar.join.hint")}</p>
        {!slots ? (
          <Fragment key="ask-code">
            <input
              className="mt-3.5 h-[60px] w-full rounded-2xl bg-surface px-4 text-center font-title text-[26px] font-semibold uppercase tracking-[0.14em] outline-none focus:ring-2 focus:ring-ring/40"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              aria-label={t("hogar.join.codeLabel")}
            />
            <button
              onClick={() => lookup.mutate(code, { onSuccess: (found) => setSlots(found) })}
              disabled={lookup.isPending || code.trim().length < 4}
              className="mt-2.5 w-full rounded-full bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {lookup.isPending ? t("hogar.join.searching") : t("hogar.join.submit")}
            </button>
          </Fragment>
        ) : slots.length ? (
          <Fragment key="pick-who">
            <p className="mt-3 text-xs text-muted-foreground">{t("hogar.join.pickWho")}</p>
            <div className="mt-2 space-y-2">
              {slots.map((s) => {
                const pal = personColor(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() =>
                      claim.mutate(
                        { code, memberId: s.id },
                        {
                          onSuccess: () => {
                            setCode("");
                            setSlots(null);
                          },
                        },
                      )
                    }
                    disabled={claim.isPending}
                    className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-sm font-medium disabled:opacity-60"
                  >
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-title text-sm font-semibold"
                      style={{ background: pal.soft, color: pal.ink }}
                    >
                      {(s.display_name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    {s.display_name}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setSlots(null)}
              className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("hogar.join.otherCode")}
            </button>
          </Fragment>
        ) : (
          <Fragment key="no-slots">
            <p className="mt-3 text-xs text-muted-foreground">{t("hogar.join.noSlots")}</p>
            <button
              onClick={() => setSlots(null)}
              className="mt-3 text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("hogar.join.otherCode")}
            </button>
          </Fragment>
        )}
      </section>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t("hogar.orStart")}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <section className="surface-card space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary-ink" /> {t("hogar.create.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("hogar.create.hint")}</p>
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("hogar.create.nameLabel")}
          aria-label={t("hogar.create.nameLabel")}
        />
        <button
          onClick={() => create.mutate(name)}
          disabled={create.isPending}
          className="w-full rounded-full bg-secondary py-3.5 text-sm font-semibold disabled:opacity-60"
        >
          {create.isPending ? t("hogar.create.creating") : t("hogar.create.submit")}
        </button>
      </section>

      <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-secondary/60 px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" />
        <p>{t("hogar.privacy")}</p>
      </div>
    </>
  );
}
