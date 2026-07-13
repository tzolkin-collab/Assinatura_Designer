import React from 'react';
import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
}

export default function PageHeader({ title, description, actions, icon }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.textContainer}>
        {icon && <div className={styles.icon}>{icon}</div>}
        <div className={styles.text}>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
