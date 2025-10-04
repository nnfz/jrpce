// src/components/Profile.tsx
import React, { useEffect, useRef, useState } from 'react';

interface WindowInfo {
  hwnd: string;
  title: string;
  process_name: string;
  icon_path: string;
  display_name: string;
  document_name: string;
}

interface ProfileProps {
  displayName: string;
  setDisplayName: (name: string) => void;
  handleName: string;
  setHandleName: (name: string) => void;
  roles: Array<{ id: string; name: string; color: string }>;
  removingRoleId: string | null;
  setRemovingRoleId: (id: string | null) => void;
  addRole: () => void;
  removeRole: (id: string) => void;
  updateRoleName: (id: string, name: string) => void;
  activityWindow: WindowInfo | null;
  activityPhase: 'idle' | 'inHeight' | 'inCard' | 'out';
  activityTime: number;
  formatTime: (seconds: number) => string;
  activityWrapRef: React.RefObject<HTMLDivElement | null>;
  activityType: string;
  setActivityType: (type: string) => void;
  // должен быть передан из App.tsx: apply сохраняет конфиг и вызывает update_rpc
  onApplyActivityType: () => Promise<void> | void;
}

export const Profile: React.FC<ProfileProps> = ({
  displayName,
  setDisplayName,
  handleName,
  setHandleName,
  roles,
  removingRoleId,
  setRemovingRoleId,
  addRole,
  removeRole,
  updateRoleName,
  activityWindow,
  activityPhase,
  activityTime,
  formatTime,
  activityWrapRef,
  activityType,
  setActivityType,
  onApplyActivityType
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const activityOptions = ['playing', 'listening', 'watching', 'competing'];

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  // close menu on outside click
  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) {
      document.addEventListener('click', onDocClick);
    }
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  // helper: set + apply immediately
  const setAndApply = (opt: string) => {
    try {
      setActivityType(opt);
    } catch (e) {
      console.error("setActivityType failed:", e);
    }

    // call apply (may return promise)
    try {
      const res = onApplyActivityType();
      if (res && typeof (res as any).catch === 'function') {
        // если вернулся промис, ловим ошибки
        (res as Promise<void>).catch((err) => {
          console.error("onApplyActivityType promise rejected:", err);
        });
      }
    } catch (err) {
      console.error("onApplyActivityType threw:", err);
    }
  };

  return (
    <div className="ds-container">
      <div className="profile-panel" aria-label="Profile">
        <div className="profile-banner" />
        <div className="profile-card">
          <div className="avatar-wrap">
            <img src='icons/user.png' alt="avatar" className="avatar-lg" />
            <span className="status-dot online dot-lg" />
          </div>

          <div className="profile-names">
            <div
              className="display-name"
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={(e) => {
                const value = e.currentTarget.textContent || '';
                setDisplayName(value);
              }}
            >
              {displayName}
            </div>
            <div className="handle-row">
              <span
                className="handle"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onBlur={(e) => {
                  const value = e.currentTarget.textContent || '';
                  setHandleName(value);
                }}
              >
                {handleName}
              </span>
            </div>
          </div>

          {/* Игровая активность */}
          <div className="game-activity" ref={activityWrapRef}>
            {activityWindow && (
              <div
                key={activityWindow.hwnd}
                className={`activity-game ${activityPhase === 'inHeight' || activityPhase === 'inCard' ? 'animate-in' : activityPhase === 'out' ? 'animate-out' : ''}`}>
                <div
                  className='game-d'
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(prev => !prev);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setMenuOpen(prev => !prev);
                    }
                  }}
                >
                  {capitalize(activityType)}
                </div>

                {menuOpen && (
                  <div className="activity-menu" ref={menuRef} style={{ position: 'absolute', zIndex: 40 }}>
                    {activityOptions.map(opt => (
                      <div
                        key={opt}
                        className={`activity-option ${activityType === opt ? 'selected' : ''}`}
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          setAndApply(opt); // <-- сразу применяем и сохраняем
                        }}
                        style={{
                          padding: '6px 10px',
                          cursor: 'pointer',
                          userSelect: 'none'
                        }}
                      >
                        {capitalize(opt)}
                      </div>
                    ))}
                  </div>
                )}

                <div className='game-playing'>
                  <img src={activityWindow.icon_path} alt="app" className="game-icon" />
                  <div className="game-lines">
                    <div className='game-text'>
                      <div className="game-name">{activityWindow.display_name}</div>
                      <div className="game-detail">
                        {activityWindow.document_name || activityWindow.title}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="game-timer">
                        <svg className="game-ico" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24"><path fill="var(--text-feedback-positive)" d="M20.97 4.06c0 .18.08.35.24.43.55.28.9.82 1.04 1.42.3 1.24.75 3.7.75 7.09v4.91a3.09 3.09 0 0 1-5.85 1.38l-1.76-3.51a1.09 1.09 0 0 0-1.23-.55c-.57.13-1.36.27-2.16.27s-1.6-.14-2.16-.27c-.49-.11-1 .1-1.23.55l-1.76 3.51A3.09 3.09 0 0 1 1 17.91V13c0-3.38.46-5.85.75-7.1.15-.6.49-1.13 1.04-1.4a.47.47 0 0 0 .24-.44c0-.7.48-1.32 1.2-1.47l2.93-.62c.5-.1 1 .06 1.36.4.35.34.78.71 1.28.68a42.4 42.4 0 0 1 4.4 0c.5.03.93-.34 1.28-.69.35-.33.86-.5 1.36-.39l2.94.62c.7.15 1.19.78 1.19 1.47ZM20 7.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM15.5 12a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 7a1 1 0 0 1 2 0v1h1a1 1 0 1 1 0 2H7v1a1 1 0 1 1-2 0v-1H4a1 1 0 1 1 0-2h1V7Z" fillRule="evenodd" clipRule="evenodd"></path></svg>
                        {formatTime(activityTime)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Баджи/короткие активности */}
          <div className="activities">
            {roles.map((role) => (
              <div
                key={role.id}
                className={`activity role-pill role-appear ${removingRoleId === role.id ? 'role-disappear' : ''}`}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target && target.isContentEditable) return;
                  if (removingRoleId) return;
                  setRemovingRoleId(role.id);
                  setTimeout(() => {
                    removeRole(role.id);
                    setRemovingRoleId(null);
                  }, 300);
                }}
                title="Click to remove"
              >
                <span className="dot" style={{ background: role.color }} />
                <span
                  className="activity-text"
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => updateRoleName(role.id, (e.currentTarget.textContent || '').trimStart())}
                >
                  {role.name}
                </span>
              </div>
            ))}
            <div className="activity-plus" onClick={addRole} role="button" aria-label="Add role" title="Add role">
              <span className="activity-text">+</span>
            </div>
          </div>

          <button className="btn-primary-full">
            <svg className="btn-icon" aria-hidden="true" role="img" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="currentColor" d="m13.96 5.46 4.58 4.58a1 1 0 0 0 1.42 0l1.38-1.38a2 2 0 0 0 0-2.82l-3.18-3.18a2 2 0 0 0-2.82 0l-1.38 1.38a1 1 0 0 0 0 1.42ZM2.11 20.16l.73-4.22a3 3 0 0 1 .83-1.61l7.87-7.87a1 1 0 0 1 1.42 0l4.58 4.58a1 1 0 0 1 0 1.42l-7.87 7.87a3 3 0 0 1-1.6.83l-4.23.73a1.5 1.5 0 0 1-1.73-1.73Z" ></path></svg>
            Edit Profile</button>
        </div>
      </div>
    </div>
  );
};
