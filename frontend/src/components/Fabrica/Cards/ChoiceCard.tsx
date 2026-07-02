"use client";

import React from 'react';
import styles from './ChoiceCard.module.css';

interface ChoiceCardProps {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  tooltip: string;
  onClick: () => void;
  variant?: 'image' | 'presentation' | 'video';
}

export default function ChoiceCard({
  label,
  description,
  icon,
  tooltip,
  onClick,
  variant = 'image'
}: ChoiceCardProps) {
  return (
    <button
      type="button"
      className={[styles.card, styles[variant]].join(' ')}
      onClick={onClick}
    >
      <div className={styles.top}>
        <div className={styles.icon} aria-hidden>
          {icon}
        </div>
        <span
          className={styles.infoButton}
          role="button"
          tabIndex={0}
          aria-label={`Informações sobre ${label}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          i
          <span className={styles.infoTooltip} role="tooltip">
            {tooltip}
          </span>
        </span>
      </div>
      <h3 className={styles.title}>{label}</h3>
      <p className={styles.desc}>{description}</p>
    </button>
  );
}
