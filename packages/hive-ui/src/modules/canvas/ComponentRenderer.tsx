import React from "react";
import { getCanvasComponent } from "./CanvasComponentMap";

interface ComponentRendererProps {
  component: {
    type: string;
    props: Record<string, unknown>;
    id: string;
  };
  onInteraction: (id: string, action: string, data?: unknown) => void;
}

interface DynamicProps extends Record<string, unknown> {
  renderFn: (props: Record<string, unknown>) => React.ReactNode;
}

const DynamicCanvasComponent: React.FC<DynamicProps> = ({ renderFn, ...props }) => {
  return <>{renderFn(props)}</>;
};

export const ComponentRenderer: React.FC<ComponentRendererProps> = ({ component, onInteraction }) => {
  const { type, props, id } = component;
  const renderFn = getCanvasComponent(type);

  return (
    <div data-canvas-type={type} data-canvas-id={id}>
      <DynamicCanvasComponent renderFn={renderFn} {...props} id={id} onInteraction={onInteraction} />
    </div>
  );
};
