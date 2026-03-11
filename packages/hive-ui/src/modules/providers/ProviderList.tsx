import { useProviders } from "@/hooks/useProviders";
import { ProviderCard } from "./ProviderCard";

export function ProviderList() {
  const { providers, updateProvider } = useProviders();

  const activeCount = providers.filter(p => p.active).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="hive-title-section">Providers de IA</h3>
        <span className="hive-tag hive-tag--provider">{activeCount} activos / {providers.length} total</span>
      </div>

      {/* Mobile-first: 1 col → 2 col (sm) → 3 col (xl) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            updateProvider={updateProvider}
          />
        ))}
        {providers.length === 0 && (
          <div className="hive-empty-state col-span-full">
            No hay providers disponibles.
          </div>
        )}
      </div>
    </div>
  );
}
