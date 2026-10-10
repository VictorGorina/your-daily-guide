import { Carrot, Egg, Fish, Wheat } from "lucide-react";

// ---------------------------------------------------------------------------
// Icono Lucide por categoría de supermercado (la lista viene del plan generado
// por la IA con nombres como "Frutas y verduras", "Pescado y carne", etc.)
// ---------------------------------------------------------------------------
// Categories are free-form AI-generated text — match by keyword, not exact name.
const CATEGORY_MATCHERS: [RegExp, React.ComponentType<{ className?: string }>][] = [
  [/verdura|fruta|hortaliza/i, Carrot],
  [/pescado|carne|proteín|pollo|ternera/i, Fish],
  [/despensa|conserva|cereal|legumbre|pasta|arroz|aceite/i, Wheat],
  [/lácteo|huevo|leche|yogur|queso/i, Egg],
];
export const CategoryIcon = ({ category, className }: { category: string; className?: string }) => {
  const match = CATEGORY_MATCHERS.find(([re]) => re.test(category));
  if (!match) return null;
  const Icon = match[1];
  return <Icon className={className} />;
};
