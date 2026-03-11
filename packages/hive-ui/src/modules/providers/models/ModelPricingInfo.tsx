import type { ModelPricing } from "@/types";

interface ModelPricingInfoProps {
  pricing: ModelPricing;
}

export function ModelPricingInfo({ pricing }: ModelPricingInfoProps) {
  if (pricing.inputPer1M === 0 && pricing.outputPer1M === 0) {
    return <span className="text-xs font-medium text-hive-connected">Gratis (local)</span>;
  }
  return (
    <div className="text-right text-[10px] text-muted-foreground">
      <p>In: ${pricing.inputPer1M}/1M</p>
      <p>Out: ${pricing.outputPer1M}/1M</p>
    </div>
  );
}
