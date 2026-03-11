import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { useState } from "react";
import type { ChannelType } from "@/types";

interface ChannelSetupWizardProps {
  channelType: ChannelType;
  onComplete?: () => void;
  onCancel?: () => void;
}

const steps = ["Instrucciones", "Credenciales", "Políticas", "Test", "Confirmar"];

export function ChannelSetupWizard({ channelType, onComplete, onCancel }: ChannelSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Conectar {channelType} — Paso {currentStep + 1} de {steps.length}</CardTitle>
        <div className="flex gap-1 pt-2">
          {steps.map((step, i) => (
            <div
              key={step}
              className={`h-1 flex-1 rounded-full ${i <= currentStep ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {steps[currentStep]}: Contenido del paso pendiente de implementación
        </p>
        <div className="flex justify-between">
          <Button variant="outline" size="sm" onClick={() => currentStep === 0 ? onCancel?.() : setCurrentStep((s) => s - 1)}>
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            {currentStep === 0 ? "Cancelar" : "Anterior"}
          </Button>
          <Button size="sm" onClick={() => currentStep === steps.length - 1 ? onComplete?.() : setCurrentStep((s) => s + 1)}>
            {currentStep === steps.length - 1 ? "Conectar" : "Siguiente"}
            {currentStep < steps.length - 1 && <ChevronRight className="ml-1 h-3.5 w-3.5" />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
