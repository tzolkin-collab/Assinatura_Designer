"use client";

import React from 'react';
import styles from './LayoutCard.module.css';

interface LayoutCardProps {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  isActive: boolean;
  onClick: () => void;
}

export default function LayoutCard({
  label,
  description,
  icon,
  isActive,
  onClick
}: LayoutCardProps) {
  return (
    <button
      type="button"
      className={[styles.card, isActive ? styles.active : ''].join(' ')}
      onClick={onClick}
    >
      <div className={styles.top}>
        <div className={styles.label}>{label}</div>
        <div className={styles.icon} aria-hidden>
          {icon}
        </div>
      </div>
      <div className={styles.desc}>{description}</div>
    </button>
  );
}
