import React, { useId } from 'react';
import { HelpTooltip } from './HelpTooltip';

interface LabeledControlProps {
  label: React.ReactNode;
  description: React.ReactNode;
  children: React.ReactElement<{ 'aria-describedby'?: string }>;
  className?: string;
}

export const LabeledControl: React.FC<LabeledControlProps> = ({ label, description, children, className = '' }) => {
  const id = `control-help-${useId().replace(/:/g, '')}`;
  return (
    <label className={className}>
      <span className="mb-1 flex items-center gap-1">
        <span>{label}</span>
        <HelpTooltip id={id}>{description}</HelpTooltip>
      </span>
      {React.cloneElement(children, { 'aria-describedby': id })}
    </label>
  );
};
