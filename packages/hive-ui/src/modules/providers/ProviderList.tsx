import { useProviders } from "@/hooks/useProviders";
import { ProviderCard } from "./ProviderCard";

export function ProviderList() {
  const { providers, updateProvider } = useProviders();

  // Solo providers de texto (category 'llm'); los de voz viven en la pestaña Voz
  const textProviders = providers.filter(p => (p.category ?? "llm") === "llm");
  const activeCount = textProviders.filter(p => p.active).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="hive-title-section">Providers de IA</h3>
        <span className="hive-tag hive-tag--provider">{activeCount} activos / {textProviders.length} total</span>
      </div>

      {/* Mobile-first: 1 col → 2 col (sm) → 3 col (xl) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
        {textProviders.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            updateProvider={updateProvider}
          />
        ))}
        {textProviders.length === 0 && (
          <div className="hive-empty-state col-span-full">
            No hay providers disponibles.
          </div>
        )}
      </div>
    </div>
  );
}
