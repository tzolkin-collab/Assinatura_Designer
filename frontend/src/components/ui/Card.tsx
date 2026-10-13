'use client';

import React from 'react';
import styles from './Card.module.css';

interface CardProps {
  children: React.ReactNode;
  hover?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** `box`: unidade com contorno (item que se lê junto). `section`: bloco da página, só uma linha fina em cima. */
  variant?: 'box' | 'section';
  config?: boolean;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export default function Card({
  children,
  hover = false,
  padding = 'md',
  variant = 'box',
  config = false,
  className,
  onClick,
  style,
}: CardProps) {
  return (
    <div
      className={[
        styles.card,
        variant === 'section' ? styles.section : '',
        hover ? styles.hover : '',
        config ? styles.config : '',
        styles[`padding-${padding}`],
        onClick ? styles.clickable : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={style}
    >
      {children}
    </div>
  );
}
