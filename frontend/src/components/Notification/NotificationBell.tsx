'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import styles from './Notification.module.css';

interface Notification {
  id: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  // O painel é desenhado num portal (fora do menu lateral), então são DOIS elementos a vigiar
  // no clique fora: o botão (container) e o painel.
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    try {
      const res = await api.get<Notification[]>('/notifications');
      setNotifications(res);
    } catch (e) {
      // Poller de fundo: falha transitória de rede (backend reiniciando em dev,
      // wifi piscou) NÃO é erro de interface — o próximo tick em 30s recupera.
      // console.error aqui vira overlay de erro no Next dev a cada restart.
      if (e instanceof ApiError && e.code === 'NETWORK') return;
      console.warn('[notifications] poll falhou:', e);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    fetchNotifications();
    // Polling simples a cada 30 segundos
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (containerRef.current?.contains(alvo) || popoverRef.current?.contains(alvo)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAsRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch (e) {
      console.error(e);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await api.post('/notifications/read-all', {});
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={styles.bellBtn}
        onClick={() => setOpen(!open)}
        aria-label={unreadCount > 0 ? `Notificações, ${unreadCount} não lida${unreadCount > 1 ? 's' : ''}` : 'Notificações'}
        aria-expanded={open}
        title="Notificações"
      >
        <Bell size={18} />
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
      </button>

      {open && createPortal(
        // No portal: dentro do menu lateral o painel era preso pelo `transform` dele (que vira o
        // bloco de referência do `position: fixed`) e cortado pelo `overflow`, então abria em
        // x=270 de um menu de 260px e ficava invisível, por baixo do fundo escurecido.
        <div className={styles.popover} ref={popoverRef}>
          <div className={styles.header}>
            <h4>Notificações</h4>
            {unreadCount > 0 && (
              <button className={styles.markAll} onClick={handleMarkAllAsRead}>
                Marcar todas lidas
              </button>
            )}
          </div>
          <div className={styles.list}>
            {notifications.length === 0 ? (
              <div className={styles.empty}>Nenhuma notificação.</div>
            ) : (
              notifications.map(n => (
                <div key={n.id} className={`${styles.item} ${n.read ? styles.read : ''}`}>
                  <div className={styles.content}>
                    <strong>{n.title}</strong>
                    <p>{n.message}</p>
                    <span className={styles.time}>{new Date(n.createdAt).toLocaleDateString()}</span>
                  </div>
                  {!n.read && (
                    <button className={styles.readBtn} onClick={() => handleMarkAsRead(n.id)} title="Marcar como lida">
                      <Check size={14} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
