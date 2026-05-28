import React from 'react';
import { CustomFurnitureType } from '../api/types';

const clampColorChannel = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const adjustHexColor = (hex: string, delta: number) => {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const channels = normalized.match(/.{2}/g);
  if (!channels) return hex;
  const [r, g, b] = channels.map((channel) => clampColorChannel(parseInt(channel, 16) + delta));
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

export const getCustomFurnitureType = (
  customFurniture: CustomFurnitureType[],
  typeId: string,
) => customFurniture.find((item) => item.id === typeId) ?? null;

export const CustomFurniturePreview: React.FC<{
  furniture: CustomFurnitureType;
  className?: string;
}> = ({ furniture, className }) => {
  const fill = furniture.color || '#6B7280';
  const stroke = adjustHexColor(fill, -28);
  const accent = adjustHexColor(fill, 24);

  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" aria-hidden="true">
      {furniture.shape === 'circle' && (
        <>
          <circle cx="50" cy="50" r="34" fill={fill} stroke={stroke} strokeWidth="6" />
          <circle cx="50" cy="50" r="18" fill={accent} opacity="0.35" />
        </>
      )}
      {furniture.shape === 'rounded' && (
        <>
          <rect x="14" y="20" width="72" height="60" rx="16" fill={fill} stroke={stroke} strokeWidth="6" />
          <rect x="28" y="32" width="44" height="14" rx="7" fill={accent} opacity="0.35" />
        </>
      )}
      {furniture.shape === 'lshaped' && (
        <>
          <path
            d="M16 20 H84 V48 H56 V80 H16 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth="6"
            strokeLinejoin="round"
          />
          <path
            d="M34 34 H66 V48 H48 V66 H34 Z"
            fill={accent}
            opacity="0.35"
          />
        </>
      )}
      {furniture.shape === 'rectangle' && (
        <>
          <rect x="14" y="24" width="72" height="52" rx="6" fill={fill} stroke={stroke} strokeWidth="6" />
          <rect x="24" y="34" width="52" height="12" rx="4" fill={accent} opacity="0.35" />
        </>
      )}
    </svg>
  );
};
